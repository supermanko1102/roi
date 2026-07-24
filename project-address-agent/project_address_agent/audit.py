from __future__ import annotations

from collections import Counter
from typing import Any

from .db import audit_projects, connect, sync_audit_cases


def run_audit(*, write: bool = False, limit: int = 20) -> dict[str, Any]:
    with connect() as conn:
        projects = audit_projects(conn)
        written = sync_audit_cases(conn, projects) if write else 0
        counts = Counter(project.reason for project in projects)
        unresolved = [project.as_dict() for project in projects if project.reason != "resolved"]
        returned = unresolved[: max(0, min(limit, 200))]
        return {
            "summary": dict(sorted(counts.items())),
            "total_groups": len(projects),
            "unresolved_count": len(unresolved),
            "cases_written": written,
            "returned_projects": len(returned),
            "projects": returned,
        }
