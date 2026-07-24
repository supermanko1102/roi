from __future__ import annotations

import pytest

from project_address_agent.db import (
    apply_published,
    auto_publish_candidate,
    publish_candidate,
    stage_candidate,
)
from project_address_agent.models import ValidationResult


class _PublishedResult:
    def fetchone(self) -> dict[str, str]:
        return {"status": "published"}


class _PublishedConnection:
    def execute(self, *_: object, **__: object) -> _PublishedResult:
        return _PublishedResult()


class _CandidateResult:
    def __init__(self, row: dict[str, object]):
        self.row = row

    def fetchone(self) -> dict[str, object]:
        return self.row


class _CandidateConnection:
    def __init__(self, row: dict[str, object]):
        self.row = row

    def execute(self, *_: object, **__: object) -> _CandidateResult:
        return _CandidateResult(self.row)


class _AutoPublishConnection:
    def __init__(self, row: dict[str, object]):
        self.row = row

    def execute(self, query: str, *_: object, **__: object) -> _CandidateResult:
        if "UPDATE projects" in query:
            return _CandidateResult({"id": 99})
        return _CandidateResult(self.row)


def _automatic_row() -> dict[str, object]:
    return {
        "id": 1,
        "case_id": 2,
        "status": "validated",
        "candidate_value": "縣府路1號",
        "source_type": "moi_transaction",
        "source_reference": "presale_deals:縣府路1號",
        "validation": {"ok": True, "in_district": True},
        "evidence": {
            "_auto_gate": {
                "runner": "project_address_agent.automatic",
                "coordinate_cluster_count": 1,
                "validated_candidate_count": 1,
                "radius_m": 25,
            }
        },
        "lat": 24.993058,
        "lng": 121.300985,
        "precision": "door",
        "city": "桃園市",
        "district": "桃園區",
        "project_name": "測試建案",
    }


def test_publish_is_disabled_without_explicit_environment_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADDRESS_AGENT_ALLOW_PUBLISH", "0")
    with pytest.raises(PermissionError, match="ADDRESS_AGENT_ALLOW_PUBLISH"):
        publish_candidate(object(), candidate_id=1)  # type: ignore[arg-type]


def test_reapply_is_disabled_without_explicit_environment_flag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("ADDRESS_AGENT_ALLOW_PUBLISH", "0")
    with pytest.raises(PermissionError, match="ADDRESS_AGENT_ALLOW_PUBLISH"):
        apply_published(object())  # type: ignore[arg-type]


def test_published_candidate_cannot_be_revalidated() -> None:
    validation = ValidationResult(
        ok=True,
        kind="door",
        candidate="縣府路1號",
        precision="door",
        lat=24.993058,
        lng=121.300985,
        in_district=True,
        message="ok",
        provider_payload={},
    )
    with pytest.raises(ValueError, match="immutable"):
        stage_candidate(
            _PublishedConnection(),  # type: ignore[arg-type]
            case={"id": 1},
            kind="door",
            candidate="縣府路1號",
            source_type="government",
            source_reference="NLSC",
            rationale="test",
            evidence={},
            validation=validation,
        )


def test_automatic_publish_rejects_agent_declared_government_source() -> None:
    row = {
        "id": 1,
        "case_id": 2,
        "status": "validated",
        "source_type": "government",
        "source_reference": "https://example.gov.tw/",
        "validation": {"ok": True, "in_district": True},
        "evidence": {
            "_auto_gate": {
                "runner": "project_address_agent.automatic",
                "coordinate_cluster_count": 1,
                "validated_candidate_count": 1,
                "radius_m": 25,
            }
        },
        "lat": 24.993058,
        "lng": 121.300985,
        "precision": "door",
        "city": "桃園市",
        "district": "桃園區",
        "project_name": "測試建案",
    }
    with pytest.raises(ValueError, match="automatic publication gate"):
        auto_publish_candidate(
            _CandidateConnection(row),  # type: ignore[arg-type]
            candidate_id=1,
        )


def test_automatic_publish_requires_runner_cluster_attestation() -> None:
    row = _automatic_row()
    row["evidence"] = {}
    with pytest.raises(ValueError, match="automatic publication gate"):
        auto_publish_candidate(
            _CandidateConnection(row),  # type: ignore[arg-type]
            candidate_id=1,
        )


def test_automatic_publish_accepts_complete_deterministic_gate() -> None:
    result = auto_publish_candidate(
        _AutoPublishConnection(_automatic_row()),  # type: ignore[arg-type]
        candidate_id=1,
    )

    assert result["project_id"] == 99
    assert result["project_name"] == "測試建案"
    assert result["precision"] == "door"
