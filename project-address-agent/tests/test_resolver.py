from project_address_agent.models import ValidationResult
from project_address_agent.resolver import (
    EvidenceCandidate,
    ValidatedCandidate,
    candidates_from_evidence,
    coordinate_clusters,
    extract_text_candidates,
)


def _validated(lat: float, lng: float, value: str = "縣府路1號") -> ValidatedCandidate:
    candidate = EvidenceCandidate(
        kind="door",
        value=value,
        source_type="moi_transaction",
        source_reference=f"presale_deals:{value}",
        raw_value=value,
    )
    validation = ValidationResult(
        ok=True,
        kind="door",
        candidate=value,
        precision="door",
        lat=lat,
        lng=lng,
        in_district=True,
        message="ok",
        provider_payload={},
    )
    return ValidatedCandidate(candidate=candidate, validation=validation)


def test_extracts_exact_door_and_removes_floor_suffix() -> None:
    candidates = extract_text_candidates(
        city="新北市",
        district="三峽區",
        raw="新北市三峽區民生街1巷1之65號10樓 A3-10F",
        source_type="moi_transaction",
        source_reference="presale_deals:test",
    )
    assert [(candidate.kind, candidate.value) for candidate in candidates] == [
        ("door", "民生街1巷1之65號")
    ]


def test_extracts_intersection_and_embedded_land_lot() -> None:
    candidates = extract_text_candidates(
        city="桃園市",
        district="中壢區",
        raw="桃園市中壢區永園路一段與永裕路交叉口青溪段567地號",
        source_type="moi_transaction",
        source_reference="presale_deals:test",
    )
    assert {(candidate.kind, candidate.value) for candidate in candidates} == {
        ("cross", "永園路一段與永裕路"),
        ("lot", "青溪段567地號"),
    }


def test_road_only_text_is_not_an_automatic_candidate() -> None:
    assert (
        extract_text_candidates(
            city="桃園市",
            district="桃園區",
            raw="桃園市桃園區慈文路",
            source_type="moi_transaction",
            source_reference="presale_deals:test",
        )
        == []
    )


def test_same_candidate_prefers_transaction_evidence() -> None:
    evidence = {
        "transaction_addresses": [{"address": "桃園市桃園區縣府路1號"}],
        "moi_communities": [{"case_no": "A1", "street": "縣府路1號"}],
        "moi_buildcase_rows": [],
    }
    candidates = candidates_from_evidence(
        city="桃園市",
        district="桃園區",
        evidence=evidence,
    )
    assert len(candidates) == 1
    assert candidates[0].source_type == "moi_transaction"


def test_nearby_validations_form_one_cluster() -> None:
    clusters = coordinate_clusters(
        [
            _validated(24.993058, 121.300985),
            _validated(24.9931, 121.3010, "縣府路2號"),
        ]
    )
    assert len(clusters) == 1


def test_conflicting_validations_form_multiple_clusters() -> None:
    clusters = coordinate_clusters(
        [
            _validated(24.993058, 121.300985),
            _validated(25.000000, 121.310000, "另一地址1號"),
        ]
    )
    assert len(clusters) == 2


def test_coordinate_cluster_does_not_chain_distant_endpoints() -> None:
    clusters = coordinate_clusters(
        [
            _validated(25.000000, 121.000000),
            _validated(25.000000, 121.000200, "中間路1號"),
            _validated(25.000000, 121.000400, "末端路1號"),
        ]
    )
    assert len(clusters) == 2
