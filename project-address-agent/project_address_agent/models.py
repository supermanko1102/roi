from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

FailureReason = Literal[
    "missing_name",
    "name_mangled",
    "below_threshold",
    "project_missing",
    "project_no_coord",
    "resolved",
]
CandidateKind = Literal["door", "cross", "lot"]
CandidateStatus = Literal[
    "validated",
    "needs_review",
    "rejected",
    "approved",
    "published",
]


@dataclass(frozen=True)
class AuditProject:
    city: str
    district: str
    project_name: str | None
    active_deals: int
    cancelled_deals: int
    addresses: list[str]
    project_id: int | None
    lat: float | None
    lng: float | None
    reason: FailureReason

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    kind: CandidateKind
    candidate: str
    precision: str | None
    lat: float | None
    lng: float | None
    in_district: bool
    message: str
    provider_payload: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def classify_project(
    *,
    project_name: str | None,
    active_deals: int,
    project_id: int | None,
    lat: float | None,
    lng: float | None,
) -> FailureReason:
    if not project_name:
        return "missing_name"
    if active_deals < 3:
        return "below_threshold"
    if project_id is None:
        return "project_missing"
    if lat is not None and lng is not None:
        return "resolved"
    if "?" in project_name or "�" in project_name:
        return "name_mangled"
    return "project_no_coord"
