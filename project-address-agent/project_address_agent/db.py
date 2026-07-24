from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row

from .config import get_settings
from .models import AuditProject, ValidationResult, classify_project

ACTIONABLE_REASONS = {"name_mangled", "project_missing", "project_no_coord"}
OFFICIAL_SOURCE_TYPES = {
    "moi_transaction",
    "moi_community",
    "moi_buildcase",
    "moi_contract",
    "government",
    "manual_official",
}
AUTO_SOURCE_TYPES = {
    "moi_transaction": "presale_deals:",
    "moi_community": "communities:",
    "moi_buildcase": "moi_buildcase:",
}


@contextmanager
def connect() -> Iterator[Connection[dict[str, Any]]]:
    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        yield conn


def active_etl_run(conn: Connection[dict[str, Any]]) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT id, workflow, started_at
        FROM etl_runs
        WHERE status = 'running'
          AND started_at > now() - interval '8 hours'
        ORDER BY started_at DESC
        LIMIT 1
        """
    ).fetchone()


def audit_projects(conn: Connection[dict[str, Any]]) -> list[AuditProject]:
    rows = conn.execute(
        """
        SELECT d.city, d.district, d.project_name,
               count(*) FILTER (WHERE d.is_cancelled IS NOT TRUE)::int AS active_deals,
               count(*) FILTER (WHERE d.is_cancelled IS TRUE)::int AS cancelled_deals,
               coalesce(
                 array_agg(DISTINCT d.address) FILTER (
                   WHERE d.address IS NOT NULL AND btrim(d.address) <> ''
                 ),
                 ARRAY[]::text[]
               ) AS addresses,
               p.id AS project_id, p.lat::float8 AS lat, p.lng::float8 AS lng
        FROM presale_deals d
        LEFT JOIN projects p
          ON p.city = d.city
         AND p.district = d.district
         AND p.name = d.project_name
        GROUP BY d.city, d.district, d.project_name, p.id, p.lat, p.lng
        ORDER BY d.city, d.district, d.project_name NULLS FIRST
        """
    ).fetchall()
    return [
        AuditProject(
            city=row["city"],
            district=row["district"],
            project_name=row["project_name"],
            active_deals=row["active_deals"],
            cancelled_deals=row["cancelled_deals"],
            addresses=list(row["addresses"]),
            project_id=row["project_id"],
            lat=row["lat"],
            lng=row["lng"],
            reason=classify_project(
                project_name=row["project_name"],
                active_deals=row["active_deals"],
                project_id=row["project_id"],
                lat=row["lat"],
                lng=row["lng"],
            ),
        )
        for row in rows
    ]


def sync_audit_cases(
    conn: Connection[dict[str, Any]],
    projects: list[AuditProject],
) -> int:
    written = 0
    for project in projects:
        if project.project_name is None or project.reason not in ACTIONABLE_REASONS:
            continue
        conn.execute(
            """
            INSERT INTO project_location_cases(
              city, district, project_name, failure_reason, status,
              active_deals, cancelled_deals, raw_addresses,
              last_audited_at, created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'open', %s, %s, %s::jsonb, now(), now(), now())
            ON CONFLICT (city, district, project_name) DO UPDATE SET
              failure_reason = EXCLUDED.failure_reason,
              active_deals = EXCLUDED.active_deals,
              cancelled_deals = EXCLUDED.cancelled_deals,
              raw_addresses = EXCLUDED.raw_addresses,
              last_audited_at = now(),
              status = CASE
                WHEN project_location_cases.status IN ('published', 'staged')
                  THEN project_location_cases.status
                ELSE 'open'
              END
            """,
            (
                project.city,
                project.district,
                project.project_name,
                project.reason,
                project.active_deals,
                project.cancelled_deals,
                json.dumps(project.addresses, ensure_ascii=False),
            ),
        )
        written += 1

    conn.execute(
        """
        UPDATE project_location_cases c
        SET status = 'closed', updated_at = now(), last_audited_at = now()
        FROM projects p
        WHERE p.city = c.city
          AND p.district = c.district
          AND p.name = c.project_name
          AND p.lat IS NOT NULL
          AND p.lng IS NOT NULL
          AND c.status NOT IN ('published', 'closed')
        """
    )
    return written


def list_cases(
    conn: Connection[dict[str, Any]],
    *,
    limit: int = 20,
    city: str | None = None,
    statuses: tuple[str, ...] = ("open", "researching", "staged"),
) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT id, city, district, project_name, failure_reason, status,
               active_deals, cancelled_deals, raw_addresses,
               last_audited_at, updated_at
        FROM project_location_cases
        WHERE status = ANY(%s)
          AND (%s::text IS NULL OR city = %s)
        ORDER BY
          CASE failure_reason
            WHEN 'project_no_coord' THEN 0
            WHEN 'name_mangled' THEN 1
            ELSE 2
          END,
          active_deals DESC,
          id
        LIMIT %s
        """,
        (list(statuses), city, city, max(1, min(limit, 200))),
    ).fetchall()


def list_auto_cases(
    conn: Connection[dict[str, Any]],
    *,
    limit: int = 50,
    city: str | None = None,
) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT id, city, district, project_name, failure_reason, status,
               active_deals, cancelled_deals, raw_addresses,
               last_audited_at, updated_at
        FROM project_location_cases
        WHERE status IN ('open', 'researching', 'staged')
          AND failure_reason IN ('project_no_coord', 'name_mangled')
          AND (%s::text IS NULL OR city = %s)
        ORDER BY updated_at ASC, active_deals DESC, id
        LIMIT %s
        """,
        (city, city, max(1, min(limit, 500))),
    ).fetchall()


def list_auto_cases_by_ids(
    conn: Connection[dict[str, Any]],
    *,
    case_ids: list[int],
) -> list[dict[str, Any]]:
    if not case_ids:
        return []
    return conn.execute(
        """
        SELECT id, city, district, project_name, failure_reason, status,
               active_deals, cancelled_deals, raw_addresses,
               last_audited_at, updated_at
        FROM project_location_cases
        WHERE id = ANY(%s)
          AND status IN ('open', 'researching', 'staged')
          AND failure_reason IN ('project_no_coord', 'name_mangled')
        ORDER BY array_position(%s::int[], id)
        """,
        (case_ids, case_ids),
    ).fetchall()


def mark_auto_cases_attempted(
    conn: Connection[dict[str, Any]],
    *,
    case_ids: list[int],
) -> None:
    if not case_ids:
        return
    conn.execute(
        """
        UPDATE project_location_cases
        SET updated_at = clock_timestamp(),
            status = CASE
              WHEN status IN ('staged', 'published') THEN status
              ELSE 'researching'
            END
        WHERE id = ANY(%s)
        """,
        (case_ids,),
    )


def get_case(
    conn: Connection[dict[str, Any]],
    city: str,
    district: str,
    project_name: str,
) -> dict[str, Any] | None:
    return conn.execute(
        """
        SELECT * FROM project_location_cases
        WHERE city = %s AND district = %s AND project_name = %s
        """,
        (city, district, project_name),
    ).fetchone()


def ensure_case(
    conn: Connection[dict[str, Any]],
    city: str,
    district: str,
    project_name: str,
) -> dict[str, Any]:
    existing = get_case(conn, city, district, project_name)
    if existing is None and district:
        # Some historical MOI rows have an empty district even though their
        # address text includes it. Allow a verified district to validate the
        # candidate while keeping the original database key as the write target.
        existing = get_case(conn, city, "", project_name)
    if existing:
        return existing
    projects = audit_projects(conn)
    project = next(
        (
            item
            for item in projects
            if (item.city, item.district, item.project_name) == (city, district, project_name)
        ),
        None,
    )
    if project is None and district:
        project = next(
            (
                item
                for item in projects
                if (item.city, item.district, item.project_name) == (city, "", project_name)
            ),
            None,
        )
    if project is None:
        raise ValueError("Project does not exist in presale_deals.")
    if project.reason not in ACTIONABLE_REASONS:
        raise ValueError(f"Project is not an actionable repair case: {project.reason}.")
    sync_audit_cases(conn, [project])
    case = get_case(conn, city, district, project_name)
    if case is None and district:
        case = get_case(conn, city, "", project_name)
    if case is None:
        raise RuntimeError("Failed to create project location case.")
    return case


def stage_candidate(
    conn: Connection[dict[str, Any]],
    *,
    case: dict[str, Any],
    kind: str,
    candidate: str,
    source_type: str,
    source_reference: str,
    rationale: str,
    evidence: dict[str, Any],
    validation: ValidationResult,
) -> dict[str, Any]:
    if not source_reference.strip():
        raise ValueError("source_reference is required.")
    if validation.ok:
        status = "validated" if source_type in OFFICIAL_SOURCE_TYPES else "needs_review"
    else:
        status = "rejected"
    existing = conn.execute(
        """
        SELECT status
        FROM project_location_candidates
        WHERE case_id = %s AND candidate_kind = %s AND candidate_value = %s
        FOR UPDATE
        """,
        (case["id"], kind, candidate),
    ).fetchone()
    if existing and existing["status"] == "published":
        raise ValueError("Published candidates are immutable; create a new candidate.")
    row = conn.execute(
        """
        INSERT INTO project_location_candidates(
          case_id, candidate_kind, candidate_value, source_type, source_reference,
          rationale, evidence, validation, lat, lng, precision, status,
          created_at, updated_at
        )
        VALUES (
          %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
          %s, %s, %s, %s, now(), now()
        )
        ON CONFLICT (case_id, candidate_kind, candidate_value) DO UPDATE SET
          source_type = EXCLUDED.source_type,
          source_reference = EXCLUDED.source_reference,
          rationale = EXCLUDED.rationale,
          evidence = EXCLUDED.evidence,
          validation = EXCLUDED.validation,
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          precision = EXCLUDED.precision,
          status = EXCLUDED.status,
          reviewed_by = NULL,
          review_note = NULL,
          reviewed_at = NULL,
          updated_at = now()
        RETURNING *
        """,
        (
            case["id"],
            kind,
            candidate,
            source_type,
            source_reference,
            rationale,
            json.dumps(evidence, ensure_ascii=False),
            json.dumps(validation.as_dict(), ensure_ascii=False),
            validation.lat,
            validation.lng,
            validation.precision,
            status,
        ),
    ).fetchone()
    conn.execute(
        """
        UPDATE project_location_cases
        SET status = %s, updated_at = now()
        WHERE id = %s AND status <> 'published'
        """,
        ("staged" if validation.ok else "researching", case["id"]),
    )
    if row is None:
        raise RuntimeError("Failed to stage candidate.")
    return row


def list_candidates(
    conn: Connection[dict[str, Any]],
    *,
    limit: int = 50,
    statuses: tuple[str, ...] = ("validated", "needs_review", "approved"),
) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT cand.*, c.city, c.district, c.project_name, c.failure_reason
        FROM project_location_candidates cand
        JOIN project_location_cases c ON c.id = cand.case_id
        WHERE cand.status = ANY(%s)
        ORDER BY cand.updated_at DESC, cand.id DESC
        LIMIT %s
        """,
        (list(statuses), max(1, min(limit, 200))),
    ).fetchall()


def list_case_candidate_proposals(
    conn: Connection[dict[str, Any]],
    *,
    case_id: int,
) -> list[dict[str, Any]]:
    return conn.execute(
        """
        SELECT candidate_kind, candidate_value, status
        FROM project_location_candidates
        WHERE case_id = %s
          AND status IN ('validated', 'needs_review', 'approved')
        ORDER BY updated_at DESC, id DESC
        """,
        (case_id,),
    ).fetchall()


def review_candidate(
    conn: Connection[dict[str, Any]],
    *,
    candidate_id: int,
    approve: bool,
    reviewer: str,
    note: str | None,
) -> dict[str, Any]:
    if not reviewer.strip():
        raise ValueError("reviewer is required.")
    row = conn.execute(
        """
        UPDATE project_location_candidates
        SET status = %s, reviewed_by = %s, review_note = %s,
            reviewed_at = now(), updated_at = now()
        WHERE id = %s
          AND status IN ('validated', 'needs_review', 'approved')
        RETURNING *
        """,
        ("approved" if approve else "rejected", reviewer, note, candidate_id),
    ).fetchone()
    if row is None:
        raise ValueError("Candidate does not exist or is not reviewable.")
    return row


def _candidate_for_publish(
    conn: Connection[dict[str, Any]],
    *,
    candidate_id: int,
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT cand.*, c.city, c.district, c.project_name
        FROM project_location_candidates cand
        JOIN project_location_cases c ON c.id = cand.case_id
        WHERE cand.id = %s
        FOR UPDATE
        """,
        (candidate_id,),
    ).fetchone()
    if row is None:
        raise ValueError("Candidate not found.")
    if row["lat"] is None or row["lng"] is None or row["precision"] not in {"door", "cross", "lot"}:
        raise ValueError("Candidate has no valid deterministic location.")
    return row


def _write_published_candidate(
    conn: Connection[dict[str, Any]],
    *,
    row: dict[str, Any],
) -> dict[str, Any]:
    updated = conn.execute(
        """
        UPDATE projects
        SET lat = %s, lng = %s
        WHERE city = %s AND district = %s AND name = %s
        RETURNING id
        """,
        (row["lat"], row["lng"], row["city"], row["district"], row["project_name"]),
    ).fetchone()
    if updated is None:
        raise ValueError("Target project is missing; rerun audit before publishing.")

    cache_key = f"proj|{row['city']}|{row['district']}|{row['candidate_value']}"
    conn.execute(
        """
        INSERT INTO geocode_cache(addr_key, lat, lng, precision, queried_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (addr_key) DO UPDATE SET
          lat = EXCLUDED.lat,
          lng = EXCLUDED.lng,
          precision = EXCLUDED.precision,
          queried_at = now()
        """,
        (cache_key, row["lat"], row["lng"], row["precision"]),
    )
    conn.execute(
        """
        UPDATE project_location_candidates
        SET status = 'published', published_at = now(), updated_at = now()
        WHERE id = %s
        """,
        (row["id"],),
    )
    conn.execute(
        """
        UPDATE project_location_cases
        SET status = 'published', updated_at = now()
        WHERE id = %s
        """,
        (row["case_id"],),
    )
    return {
        "candidate_id": row["id"],
        "project_id": updated["id"],
        "city": row["city"],
        "district": row["district"],
        "project_name": row["project_name"],
        "lat": float(row["lat"]),
        "lng": float(row["lng"]),
        "precision": row["precision"],
    }


def publish_candidate(
    conn: Connection[dict[str, Any]],
    *,
    candidate_id: int,
) -> dict[str, Any]:
    if not get_settings().allow_publish:
        raise PermissionError("Set ADDRESS_AGENT_ALLOW_PUBLISH=1 for this explicit CLI run.")
    row = _candidate_for_publish(conn, candidate_id=candidate_id)
    if row["status"] != "approved":
        raise ValueError("Candidate must be approved before publishing.")
    return _write_published_candidate(conn, row=row)


def auto_publish_candidate(
    conn: Connection[dict[str, Any]],
    *,
    candidate_id: int,
) -> dict[str, Any]:
    row = _candidate_for_publish(conn, candidate_id=candidate_id)
    reference_prefix = AUTO_SOURCE_TYPES.get(row["source_type"])
    validation = row["validation"] if isinstance(row["validation"], dict) else {}
    evidence = row["evidence"] if isinstance(row["evidence"], dict) else {}
    auto_gate = evidence.get("_auto_gate", {})
    if (
        row["status"] != "validated"
        or reference_prefix is None
        or not str(row["source_reference"]).startswith(reference_prefix)
        or validation.get("ok") is not True
        or validation.get("in_district") is not True
        or not isinstance(auto_gate, dict)
        or auto_gate.get("runner") != "project_address_agent.automatic"
        or auto_gate.get("coordinate_cluster_count") != 1
        or not isinstance(auto_gate.get("validated_candidate_count"), int)
        or auto_gate["validated_candidate_count"] < 1
        or auto_gate.get("radius_m") != 25
    ):
        raise ValueError("Candidate does not satisfy the automatic publication gate.")
    conn.execute(
        """
        UPDATE project_location_candidates
        SET status = 'approved',
            reviewed_by = 'auto:official-evidence',
            review_note = 'Unique NLSC coordinate cluster from local MOI evidence.',
            reviewed_at = now(),
            updated_at = now()
        WHERE id = %s
        """,
        (candidate_id,),
    )
    row["status"] = "approved"
    row["reviewed_by"] = "auto:official-evidence"
    return _write_published_candidate(conn, row=row)


def _apply_published(conn: Connection[dict[str, Any]]) -> int:
    result = conn.execute(
        """
        WITH preferred AS (
          SELECT DISTINCT ON (c.city, c.district, c.project_name)
                 c.city, c.district, c.project_name, cand.lat, cand.lng
          FROM project_location_candidates cand
          JOIN project_location_cases c ON c.id = cand.case_id
          WHERE cand.status = 'published'
            AND cand.lat IS NOT NULL
            AND cand.lng IS NOT NULL
          ORDER BY c.city, c.district, c.project_name, cand.published_at DESC NULLS LAST
        )
        UPDATE projects p
        SET lat = preferred.lat, lng = preferred.lng
        FROM preferred
        WHERE p.city = preferred.city
          AND p.district = preferred.district
          AND p.name = preferred.project_name
        """
    )
    return result.rowcount


def apply_published(conn: Connection[dict[str, Any]]) -> int:
    if not get_settings().allow_publish:
        raise PermissionError("Set ADDRESS_AGENT_ALLOW_PUBLISH=1 for this explicit CLI run.")
    return _apply_published(conn)


def apply_published_automatic(conn: Connection[dict[str, Any]]) -> int:
    return _apply_published(conn)
