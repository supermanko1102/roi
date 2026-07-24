from __future__ import annotations

import json
import time
from collections import Counter
from typing import Any

from .db import (
    apply_published_automatic,
    audit_projects,
    auto_publish_candidate,
    connect,
    list_auto_cases,
    mark_auto_cases_attempted,
    stage_candidate,
    sync_audit_cases,
)
from .evidence import collect_project_evidence
from .nlsc import NlscClient
from .resolver import (
    ValidatedCandidate,
    candidates_from_evidence,
    coordinate_clusters,
)

MAX_CANDIDATES_PER_CASE = 20
RATE_SECONDS = 0.15
KIND_PRIORITY = {"door": 0, "cross": 1, "lot": 2}


def _validation_district(
    *,
    client: NlscClient,
    case: dict[str, Any],
    evidence: dict[str, Any],
) -> str | None:
    if case["district"]:
        return str(case["district"])
    evidence_text = json.dumps(evidence, ensure_ascii=False)
    return client.district_index.infer_district(city=str(case["city"]), text=evidence_text)


def _resolve_case(
    *,
    case: dict[str, Any],
    client: NlscClient,
    apply: bool,
) -> dict[str, Any]:
    with connect() as conn:
        evidence = collect_project_evidence(
            conn,
            city=case["city"],
            district=case["district"],
            project_name=case["project_name"],
        )

    district = _validation_district(client=client, case=case, evidence=evidence)
    if district is None:
        return {
            "case_id": case["id"],
            "project_name": case["project_name"],
            "status": "missing_district",
        }
    candidates = candidates_from_evidence(
        city=case["city"],
        district=district,
        evidence=evidence,
    )
    if not candidates:
        return {
            "case_id": case["id"],
            "project_name": case["project_name"],
            "status": "no_precise_candidate",
        }
    if len(candidates) > MAX_CANDIDATES_PER_CASE:
        return {
            "case_id": case["id"],
            "project_name": case["project_name"],
            "status": "too_many_candidates",
            "candidate_count": len(candidates),
        }

    validated: list[ValidatedCandidate] = []
    for candidate in candidates:
        validation = client.validate(
            city=case["city"],
            district=district,
            kind=candidate.kind,
            candidate=candidate.value,
        )
        if validation.ok:
            validated.append(ValidatedCandidate(candidate=candidate, validation=validation))
        time.sleep(RATE_SECONDS)
    if not validated:
        return {
            "case_id": case["id"],
            "project_name": case["project_name"],
            "status": "no_validated_candidate",
            "candidate_count": len(candidates),
        }

    clusters = coordinate_clusters(validated)
    if len(clusters) != 1:
        return {
            "case_id": case["id"],
            "project_name": case["project_name"],
            "status": "ambiguous_coordinates",
            "validated_count": len(validated),
            "coordinate_clusters": len(clusters),
        }
    selected = min(
        clusters[0],
        key=lambda item: (
            item.candidate.priority,
            KIND_PRIORITY[item.candidate.kind],
            item.candidate.value,
        ),
    )
    result = {
        "case_id": case["id"],
        "project_name": case["project_name"],
        "status": "would_publish" if not apply else "published",
        "candidate": selected.candidate.value,
        "kind": selected.candidate.kind,
        "source_type": selected.candidate.source_type,
        "source_reference": selected.candidate.source_reference,
        "lat": selected.validation.lat,
        "lng": selected.validation.lng,
        "validated_count": len(validated),
    }
    if not apply:
        return result

    evidence["_auto_gate"] = {
        "runner": "project_address_agent.automatic",
        "coordinate_cluster_count": len(clusters),
        "validated_candidate_count": len(validated),
        "radius_m": 25,
    }
    with connect() as conn:
        row = stage_candidate(
            conn,
            case=case,
            kind=selected.candidate.kind,
            candidate=selected.candidate.value,
            source_type=selected.candidate.source_type,
            source_reference=selected.candidate.source_reference,
            rationale=(
                "Unattended repair: all validated local MOI candidates converged "
                "to one NLSC coordinate cluster."
            ),
            evidence=evidence,
            validation=selected.validation,
        )
        result["publication"] = auto_publish_candidate(conn, candidate_id=row["id"])
    return result


def run_auto_repair(
    *,
    apply: bool = False,
    limit: int = 50,
    city: str | None = None,
) -> dict[str, Any]:
    reapplied = 0
    with connect() as conn:
        if apply:
            reapplied = apply_published_automatic(conn)
        projects = audit_projects(conn)
        cases_written = sync_audit_cases(conn, projects)
        cases = list_auto_cases(conn, limit=limit, city=city)

    client = NlscClient()
    results: list[dict[str, Any]] = []
    try:
        for case in cases:
            try:
                results.append(_resolve_case(case=case, client=client, apply=apply))
            except (RuntimeError, ValueError) as error:
                results.append(
                    {
                        "case_id": case["id"],
                        "project_name": case["project_name"],
                        "status": "error",
                        "error": str(error),
                    }
                )
    finally:
        client.close()
    with connect() as conn:
        mark_auto_cases_attempted(
            conn,
            case_ids=[int(result["case_id"]) for result in results],
        )
    summary = Counter(result["status"] for result in results)
    return {
        "mode": "apply" if apply else "dry-run",
        "cases_written": cases_written,
        "previous_decisions_reapplied": reapplied,
        "processed": len(results),
        "summary": dict(sorted(summary.items())),
        "results": results,
    }
