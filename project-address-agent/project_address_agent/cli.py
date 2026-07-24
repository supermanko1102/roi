from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from .audit import run_audit
from .automatic import run_auto_repair
from .autonomous import run_autonomous_cycle
from .db import (
    apply_published,
    connect,
    list_candidates,
    list_cases,
    publish_candidate,
    review_candidate,
)
from .evidence import collect_project_evidence
from .nlsc import NlscClient


def _default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Cannot serialize {type(value).__name__}.")


def _print(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=_default))


def _location_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("city")
    parser.add_argument("district")
    parser.add_argument("project_name")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="project-address-agent",
        description="Audit and safely repair missing presale project locations.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    audit_parser = sub.add_parser("audit")
    audit_parser.add_argument("--write", action="store_true")
    audit_parser.add_argument("--limit", type=int, default=20)

    auto_parser = sub.add_parser("auto")
    auto_parser.add_argument("--apply", action="store_true")
    auto_parser.add_argument("--limit", type=int, default=50)
    auto_parser.add_argument("--city", default="")

    cycle_parser = sub.add_parser("cycle")
    cycle_parser.add_argument("--apply", action="store_true")
    cycle_parser.add_argument("--limit", type=int, default=100)
    cycle_parser.add_argument("--agent-limit", type=int, default=10)
    cycle_parser.add_argument("--max-llm-calls", type=int, default=6)
    cycle_parser.add_argument("--city", default="")

    cases_parser = sub.add_parser("cases")
    cases_parser.add_argument("--limit", type=int, default=50)
    cases_parser.add_argument("--city", default="")

    evidence_parser = sub.add_parser("evidence")
    _location_args(evidence_parser)

    validate_parser = sub.add_parser("validate")
    _location_args(validate_parser)
    validate_parser.add_argument("--kind", choices=["door", "cross", "lot"], required=True)
    validate_parser.add_argument("--candidate", required=True)

    candidates_parser = sub.add_parser("candidates")
    candidates_parser.add_argument("--limit", type=int, default=50)

    review_parser = sub.add_parser("review")
    review_parser.add_argument("candidate_id", type=int)
    decision = review_parser.add_mutually_exclusive_group(required=True)
    decision.add_argument("--approve", action="store_true")
    decision.add_argument("--reject", action="store_true")
    review_parser.add_argument("--reviewer", required=True)
    review_parser.add_argument("--note")

    publish_parser = sub.add_parser("publish")
    publish_parser.add_argument("candidate_id", type=int)

    sub.add_parser("apply-published")
    return parser


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "audit":
            _print(run_audit(write=args.write, limit=args.limit))
        elif args.command == "auto":
            _print(
                run_auto_repair(
                    apply=args.apply,
                    limit=args.limit,
                    city=args.city or None,
                )
            )
        elif args.command == "cycle":
            _print(
                run_autonomous_cycle(
                    apply=args.apply,
                    limit=args.limit,
                    agent_limit=args.agent_limit,
                    max_llm_calls=args.max_llm_calls,
                    city=args.city or None,
                )
            )
        elif args.command == "cases":
            with connect() as conn:
                _print(list_cases(conn, limit=args.limit, city=args.city or None))
        elif args.command == "evidence":
            with connect() as conn:
                _print(
                    collect_project_evidence(
                        conn,
                        city=args.city,
                        district=args.district,
                        project_name=args.project_name,
                    )
                )
        elif args.command == "validate":
            result = NlscClient().validate(
                city=args.city,
                district=args.district,
                kind=args.kind,
                candidate=args.candidate,
            )
            _print(result.as_dict())
            if not result.ok:
                raise SystemExit(2)
        elif args.command == "candidates":
            with connect() as conn:
                _print(list_candidates(conn, limit=args.limit))
        elif args.command == "review":
            with connect() as conn:
                _print(
                    review_candidate(
                        conn,
                        candidate_id=args.candidate_id,
                        approve=args.approve,
                        reviewer=args.reviewer,
                        note=args.note,
                    )
                )
        elif args.command == "publish":
            with connect() as conn:
                _print(publish_candidate(conn, candidate_id=args.candidate_id))
        elif args.command == "apply-published":
            with connect() as conn:
                _print({"updated_projects": apply_published(conn)})
    except (PermissionError, ValueError, RuntimeError) as error:
        _print({"status": "error", "error": str(error)})
        raise SystemExit(1) from error


if __name__ == "__main__":
    main(sys.argv[1:])
