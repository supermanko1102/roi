from __future__ import annotations

import asyncio
import os
from typing import Any
from uuid import uuid4

from google.adk.agents import RunConfig
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from .automatic import run_auto_repair
from .db import active_etl_run, connect

AGENT_ELIGIBLE_STATUSES = {"no_precise_candidate", "no_validated_candidate"}
DEFAULT_CASE_TIMEOUT_SECONDS = 120


def _has_model_credentials() -> bool:
    if os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"):
        return True
    return os.getenv("GOOGLE_GENAI_USE_VERTEXAI", "").lower() == "true" and bool(
        os.getenv("GOOGLE_CLOUD_PROJECT")
    )


def _active_etl_run() -> dict[str, Any] | None:
    with connect() as conn:
        return active_etl_run(conn)


def _usage_payload(metadata: Any) -> dict[str, int]:
    fields = (
        "prompt_token_count",
        "candidates_token_count",
        "thoughts_token_count",
        "cached_content_token_count",
        "tool_use_prompt_token_count",
        "total_token_count",
    )
    return {field: int(getattr(metadata, field, 0) or 0) for field in fields}


def _merge_usage(total: dict[str, int], current: dict[str, int]) -> None:
    for key, value in current.items():
        total[key] = total.get(key, 0) + value


def _case_prompt(case: dict[str, Any]) -> str:
    district = str(case.get("district") or "")
    return f"""
這是 Railway 無人值守地址修復工作，只處理下面這一案：
- case_id: {case["case_id"]}
- city: {case["city"]}
- district: {district}
- project_name: {case["project_name"]}

請直接呼叫 inspect_project_evidence 檢查這一案，不要重新 audit 或處理其他案件。
只有當本機內政部交易、community 或 buildcase 證據文字中確實包含完整門牌、
兩條道路的路口，或段名加地號時，才可 validate 並 stage 一個最強候選。
候選必須能逐字回指本機證據；不要搜尋外部網頁。若證據不足或衝突，直接結束，
且不要猜測。
你沒有發布權限，發布由後續獨立安全閘門決定。
""".strip()


async def _run_agent_cases(
    cases: list[dict[str, Any]],
    *,
    max_llm_calls: int,
    case_timeout_seconds: int = DEFAULT_CASE_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    from .agent import cron_agent

    session_service = InMemorySessionService()
    runner = Runner(
        app_name="project_address_agent",
        agent=cron_agent,
        session_service=session_service,
    )
    results: list[dict[str, Any]] = []
    total_usage: dict[str, int] = {}
    try:
        for case in cases:
            session = await session_service.create_session(
                app_name="project_address_agent",
                user_id="railway-cron",
                session_id=f"case-{case['case_id']}-{uuid4().hex}",
            )
            usage: dict[str, int] = {}
            model_calls = 0
            final_text = ""
            try:
                async with asyncio.timeout(case_timeout_seconds):
                    async for event in runner.run_async(
                        user_id="railway-cron",
                        session_id=session.id,
                        new_message=types.Content(
                            role="user",
                            parts=[types.Part(text=_case_prompt(case))],
                        ),
                        run_config=RunConfig(max_llm_calls=max_llm_calls),
                    ):
                        if event.usage_metadata is not None:
                            model_calls += 1
                            _merge_usage(usage, _usage_payload(event.usage_metadata))
                        if event.is_final_response() and event.content is not None:
                            final_text = "".join(
                                part.text or "" for part in event.content.parts or []
                            )
                status = "completed"
                error = None
            except TimeoutError:
                status = "timeout"
                error = f"Agent case exceeded {case_timeout_seconds} seconds."
            except Exception as exc:  # ADK/provider failures must not block the queue.
                status = "error"
                error = str(exc)
            _merge_usage(total_usage, usage)
            results.append(
                {
                    "case_id": case["case_id"],
                    "project_name": case["project_name"],
                    "status": status,
                    "model_calls": model_calls,
                    "usage": usage,
                    "response": final_text[:1000],
                    "error": error,
                }
            )
    finally:
        await runner.close()
    return {
        "processed": len(results),
        "usage": total_usage,
        "results": results,
    }


def run_autonomous_cycle(
    *,
    apply: bool = False,
    limit: int = 100,
    agent_limit: int = 10,
    max_llm_calls: int = 6,
    city: str | None = None,
) -> dict[str, Any]:
    active_run = _active_etl_run()
    if active_run is not None:
        return {
            "mode": "skipped",
            "status": "skipped_etl_running",
            "etl_run": active_run,
            "deterministic": None,
            "agent": None,
            "verification": None,
        }

    deterministic = run_auto_repair(apply=apply, limit=limit, city=city)
    eligible = [
        result for result in deterministic["results"] if result["status"] in AGENT_ELIGIBLE_STATUSES
    ][: max(0, min(agent_limit, 20))]

    if not apply:
        return {
            "mode": "dry-run",
            "deterministic": deterministic,
            "agent": {"status": "skipped_dry_run", "eligible": len(eligible)},
            "verification": None,
        }
    if not eligible:
        return {
            "mode": "apply",
            "deterministic": deterministic,
            "agent": {"status": "skipped_no_eligible_cases", "eligible": 0},
            "verification": None,
        }
    if not _has_model_credentials():
        return {
            "mode": "apply",
            "deterministic": deterministic,
            "agent": {
                "status": "skipped_missing_credentials",
                "eligible": len(eligible),
            },
            "verification": None,
        }

    try:
        agent_run = asyncio.run(
            _run_agent_cases(
                eligible,
                max_llm_calls=max(1, min(max_llm_calls, 12)),
            )
        )
        agent_run["status"] = "completed"
    except Exception as exc:  # Runner startup/cleanup failures must not fail the cron cycle.
        agent_run = {
            "status": "error",
            "eligible": len(eligible),
            "processed": 0,
            "usage": {},
            "results": [],
            "error": str(exc),
        }

    verification = run_auto_repair(
        apply=True,
        case_ids=[int(result["case_id"]) for result in eligible],
    )
    return {
        "mode": "apply",
        "deterministic": deterministic,
        "agent": agent_run,
        "verification": verification,
    }
