from __future__ import annotations

import asyncio
from types import SimpleNamespace

from google.adk.agents import BaseAgent
from google.adk.events import Event
from google.genai import types

from project_address_agent import agent as agent_module
from project_address_agent import autonomous


class _FakeAgent(BaseAgent):
    async def _run_async_impl(self, ctx):
        del ctx
        yield Event(
            author=self.name,
            content=types.Content(
                role="model",
                parts=[types.Part(text="已完成本機證據檢查。")],
            ),
            usage_metadata=types.GenerateContentResponseUsageMetadata(
                prompt_token_count=20,
                candidates_token_count=5,
                total_token_count=25,
            ),
        )


def _unresolved_result() -> dict[str, object]:
    return {
        "mode": "apply",
        "results": [
            {
                "case_id": 12,
                "city": "桃園市",
                "district": "桃園區",
                "project_name": "測試建案",
                "status": "no_precise_candidate",
            }
        ],
    }


def test_cycle_skips_agent_without_model_credentials(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    monkeypatch.setenv("GOOGLE_GENAI_USE_VERTEXAI", "false")
    monkeypatch.setattr(autonomous, "_active_etl_run", lambda: None)
    monkeypatch.setattr(autonomous, "run_auto_repair", lambda **_: _unresolved_result())

    result = autonomous.run_autonomous_cycle(apply=True)

    assert result["agent"] == {
        "status": "skipped_missing_credentials",
        "eligible": 1,
    }
    assert result["verification"] is None


def test_cycle_dry_run_never_calls_agent(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setattr(autonomous, "_active_etl_run", lambda: None)
    monkeypatch.setattr(autonomous, "run_auto_repair", lambda **_: _unresolved_result())

    result = autonomous.run_autonomous_cycle(apply=False)

    assert result["agent"]["status"] == "skipped_dry_run"
    assert result["verification"] is None


def test_usage_payload_records_billable_token_fields() -> None:
    usage = autonomous._usage_payload(
        SimpleNamespace(
            prompt_token_count=100,
            candidates_token_count=30,
            thoughts_token_count=20,
            cached_content_token_count=None,
            tool_use_prompt_token_count=5,
            total_token_count=155,
        )
    )

    assert usage["prompt_token_count"] == 100
    assert usage["total_token_count"] == 155


def test_cycle_skips_while_main_etl_is_running(monkeypatch) -> None:
    monkeypatch.setattr(
        autonomous,
        "_active_etl_run",
        lambda: {"id": 7, "workflow": "github-actions-schedule"},
    )

    result = autonomous.run_autonomous_cycle(apply=True)

    assert result["status"] == "skipped_etl_running"
    assert result["etl_run"]["id"] == 7


def test_programmatic_adk_runner_collects_usage_without_network(monkeypatch) -> None:
    monkeypatch.setattr(
        agent_module,
        "cron_agent",
        _FakeAgent(name="fake_address_agent"),
    )

    result = asyncio.run(
        autonomous._run_agent_cases(
            [
                {
                    "case_id": 12,
                    "city": "桃園市",
                    "district": "桃園區",
                    "project_name": "測試建案",
                }
            ],
            max_llm_calls=2,
        )
    )

    assert result["processed"] == 1
    assert result["usage"]["total_token_count"] == 25
    assert result["results"][0]["response"] == "已完成本機證據檢查。"


def test_cron_agent_has_only_bounded_local_tools() -> None:
    tool_names = {tool.__name__ for tool in agent_module.cron_agent.tools}

    assert tool_names == {
        "inspect_project_evidence",
        "validate_location_candidate",
        "stage_location_candidate",
    }


def test_runner_failure_does_not_abort_verification(monkeypatch) -> None:
    calls: list[dict[str, object]] = []

    def fake_auto_repair(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return _unresolved_result()
        return {"mode": "apply", "results": []}

    async def broken_runner(*args, **kwargs):
        del args, kwargs
        raise RuntimeError("provider unavailable")

    monkeypatch.setenv("GEMINI_API_KEY", "test-only")
    monkeypatch.setattr(autonomous, "_active_etl_run", lambda: None)
    monkeypatch.setattr(autonomous, "run_auto_repair", fake_auto_repair)
    monkeypatch.setattr(autonomous, "_run_agent_cases", broken_runner)

    result = autonomous.run_autonomous_cycle(apply=True)

    assert result["agent"]["status"] == "error"
    assert result["agent"]["error"] == "provider unavailable"
    assert result["verification"] == {"mode": "apply", "results": []}
    assert calls[1]["case_ids"] == [12]
