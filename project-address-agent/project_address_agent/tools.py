from __future__ import annotations

from typing import Any

from .db import (
    audit_projects,
    connect,
    ensure_case,
    list_candidates,
    list_cases,
    stage_candidate,
    sync_audit_cases,
)
from .evidence import collect_project_evidence
from .nlsc import NlscClient

VALID_KINDS = {"door", "cross", "lot"}


def audit_unresolved_projects(limit: int = 20, city: str = "") -> dict[str, Any]:
    """Refreshes the audit queue and returns unresolved presale project cases.

    Args:
        limit: Maximum number of cases to return, from 1 to 200.
        city: Optional exact database city name, such as 桃園市 or 臺北市.
    """
    with connect() as conn:
        projects = audit_projects(conn)
        written = sync_audit_cases(conn, projects)
        cases = list_cases(conn, limit=limit, city=city.strip() or None)
        return {
            "status": "success",
            "cases_written": written,
            "cases": cases,
            "note": "below_threshold and missing_name groups are reported by the CLI audit only.",
        }


def inspect_project_evidence(
    city: str,
    district: str,
    project_name: str,
) -> dict[str, Any]:
    """Returns local MOI, transaction, contract, and geocode evidence for a project."""
    with connect() as conn:
        evidence = collect_project_evidence(
            conn,
            city=city.strip(),
            district=district.strip(),
            project_name=project_name.strip(),
        )
        return {"status": "success", "evidence": evidence}


def validate_location_candidate(
    city: str,
    district: str,
    project_name: str,
    kind: str,
    candidate: str,
) -> dict[str, Any]:
    """Validates a textual location candidate with NLSC and district geometry.

    Args:
        city: Exact database city name.
        district: Exact MOI district name.
        project_name: Exact project name used in presale_deals.
        kind: One of door, cross, or lot.
        candidate: Address, two-road intersection, or section/land-lot text.
    """
    del project_name  # Included to keep every tool call tied to an explicit project.
    normalized_kind = kind.strip().lower()
    if normalized_kind not in VALID_KINDS:
        return {
            "status": "error",
            "error": "kind must be door, cross, or lot.",
        }
    client = NlscClient()
    try:
        result = client.validate(
            city=city.strip(),
            district=district.strip(),
            kind=normalized_kind,  # type: ignore[arg-type]
            candidate=candidate.strip(),
        )
    finally:
        client.close()
    return {
        "status": "success" if result.ok else "rejected",
        "validation": result.as_dict(),
    }


def stage_location_candidate(
    city: str,
    district: str,
    project_name: str,
    kind: str,
    candidate: str,
    source_type: str,
    source_reference: str,
    rationale: str,
) -> dict[str, Any]:
    """Deterministically validates and stages a candidate for later evaluation.

    This tool never accepts caller-supplied coordinates and never publishes to
    the projects table.
    """
    normalized_kind = kind.strip().lower()
    if normalized_kind not in VALID_KINDS:
        return {
            "status": "error",
            "error": "kind must be door, cross, or lot.",
        }
    with connect() as conn:
        case = ensure_case(
            conn,
            city=city.strip(),
            district=district.strip(),
            project_name=project_name.strip(),
        )
        evidence = collect_project_evidence(
            conn,
            city=city.strip(),
            district=case["district"],
            project_name=project_name.strip(),
        )
    client = NlscClient()
    try:
        validation = client.validate(
            city=city.strip(),
            district=district.strip(),
            kind=normalized_kind,  # type: ignore[arg-type]
            candidate=candidate.strip(),
        )
    finally:
        client.close()
    with connect() as conn:
        row = stage_candidate(
            conn,
            case=case,
            kind=normalized_kind,
            candidate=candidate.strip(),
            source_type=source_type.strip(),
            source_reference=source_reference.strip(),
            rationale=rationale.strip(),
            evidence=evidence,
            validation=validation,
        )
        return {
            "status": row["status"],
            "candidate_id": row["id"],
            "case_id": case["id"],
            "validation": validation.as_dict(),
            "next_step": (
                "The unattended runner will independently re-evaluate official "
                "evidence; this agent cannot publish."
            ),
        }


def list_staged_candidates(limit: int = 50) -> dict[str, Any]:
    """Lists validated or review-required candidates. This tool cannot approve them."""
    with connect() as conn:
        return {
            "status": "success",
            "candidates": list_candidates(conn, limit=limit),
        }
