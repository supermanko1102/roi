from __future__ import annotations

import html
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from .models import CandidateKind, ValidationResult

ROAD = (
    r"[^,，、;；()（）\s]{1,18}?(?:大道|路|街)"
    r"(?:[一二三四五六七八九十百0-9]+段)?"
)
DOOR = rf"({ROAD}(?:\d+巷)?(?:\d+弄)?\d+(?:[-之]\d+)?號)"
CROSS = rf"({ROAD})(?:與|和|及|、|/|／|，|、)({ROAD})(?:交叉口|路口|口)?"
LAND_LOT = (
    r"([^\s,，、;；()（）]{1,12}?段(?:[^\s,，、;；()（）]{1,8}?小段)?)"
    r"\s*(\d{1,4})(?:[-之.](\d{1,4}))?\s*(?:地號|號)"
)

SOURCE_PRIORITY = {
    "moi_transaction": 0,
    "moi_community": 1,
    "moi_buildcase": 2,
}


@dataclass(frozen=True)
class EvidenceCandidate:
    kind: CandidateKind
    value: str
    source_type: str
    source_reference: str
    raw_value: str

    @property
    def priority(self) -> int:
        return SOURCE_PRIORITY[self.source_type]


@dataclass(frozen=True)
class ValidatedCandidate:
    candidate: EvidenceCandidate
    validation: ValidationResult


def _normalize_raw(value: str) -> str:
    return (
        unicodedata.normalize("NFKC", html.unescape(value))
        .replace("－", "-")
        .replace("〜", "-")
        .replace("~", "-")
        .strip()
    )


def _strip_location_prefix(city: str, district: str, raw: str) -> str:
    value = _normalize_raw(raw)
    city_variants = {city, city.replace("臺", "台"), city.replace("台", "臺")}
    for _ in range(3):
        previous = value
        for prefix in sorted(city_variants, key=len, reverse=True):
            if value.startswith(prefix):
                value = value[len(prefix) :]
                break
        if district and value.startswith(district):
            value = value[len(district) :]
        if value == previous:
            break
    value = re.sub(r"^[^,，、;；()（）\s]{1,8}(?:里|村)(?:\d+鄰)?", "", value)
    return re.sub(r"\s+", "", value)


def extract_text_candidates(
    *,
    city: str,
    district: str,
    raw: str,
    source_type: str,
    source_reference: str,
) -> list[EvidenceCandidate]:
    if source_type not in SOURCE_PRIORITY or not raw.strip():
        return []
    value = _strip_location_prefix(city, district, raw)
    candidates: list[EvidenceCandidate] = []

    door = re.search(DOOR, value)
    if door:
        candidates.append(
            EvidenceCandidate(
                kind="door",
                value=door.group(1),
                source_type=source_type,
                source_reference=source_reference,
                raw_value=raw,
            )
        )

    cross = re.search(CROSS, value)
    if cross:
        candidates.append(
            EvidenceCandidate(
                kind="cross",
                value=f"{cross.group(1)}與{cross.group(2)}",
                source_type=source_type,
                source_reference=source_reference,
                raw_value=raw,
            )
        )

    land_value = value
    if cross:
        land_value = value[cross.end() :]
    else:
        road_prefix = re.match(ROAD, value)
        if road_prefix and re.search(r"段\d", value[road_prefix.end() :]):
            land_value = value[road_prefix.end() :]
    lot = re.search(LAND_LOT, land_value)
    if lot:
        number = lot.group(2)
        if lot.group(3):
            number += f"-{lot.group(3)}"
        candidates.append(
            EvidenceCandidate(
                kind="lot",
                value=f"{lot.group(1)}{number}地號",
                source_type=source_type,
                source_reference=source_reference,
                raw_value=raw,
            )
        )
    return candidates


def candidates_from_evidence(
    *,
    city: str,
    district: str,
    evidence: dict[str, Any],
) -> list[EvidenceCandidate]:
    candidates: list[EvidenceCandidate] = []
    for row in evidence.get("transaction_addresses", []):
        raw = str(row.get("address") or "").strip()
        candidates.extend(
            extract_text_candidates(
                city=city,
                district=district,
                raw=raw,
                source_type="moi_transaction",
                source_reference=f"presale_deals:{raw}",
            )
        )
    for row in evidence.get("moi_communities", []):
        raw = str(row.get("street") or "").strip()
        candidates.extend(
            extract_text_candidates(
                city=city,
                district=district,
                raw=raw,
                source_type="moi_community",
                source_reference=f"communities:{row.get('case_no', '')}",
            )
        )
    for row in evidence.get("moi_buildcase_rows", []):
        reference = f"moi_buildcase:{row.get('case_no', '')}:{row.get('source_file', '')}"
        for raw in (str(row.get("street") or ""), str(row.get("land_lot") or "")):
            candidates.extend(
                extract_text_candidates(
                    city=city,
                    district=district,
                    raw=raw,
                    source_type="moi_buildcase",
                    source_reference=reference,
                )
            )

    best_by_value: dict[tuple[CandidateKind, str], EvidenceCandidate] = {}
    for candidate in candidates:
        key = (candidate.kind, candidate.value)
        existing = best_by_value.get(key)
        if existing is None or candidate.priority < existing.priority:
            best_by_value[key] = candidate
    return sorted(
        best_by_value.values(),
        key=lambda candidate: (candidate.priority, candidate.kind, candidate.value),
    )


def _distance_m(left: ValidationResult, right: ValidationResult) -> float:
    if left.lat is None or left.lng is None or right.lat is None or right.lng is None:
        return math.inf
    lat1, lat2 = math.radians(left.lat), math.radians(right.lat)
    delta_lat = lat2 - lat1
    delta_lng = math.radians(right.lng - left.lng)
    haversine = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    )
    return 6_371_000 * 2 * math.atan2(math.sqrt(haversine), math.sqrt(1 - haversine))


def coordinate_clusters(
    candidates: list[ValidatedCandidate],
    *,
    radius_m: float = 25,
) -> list[list[ValidatedCandidate]]:
    clusters: list[list[ValidatedCandidate]] = []
    for candidate in candidates:
        for cluster in clusters:
            if all(
                _distance_m(candidate.validation, member.validation) <= radius_m
                for member in cluster
            ):
                cluster.append(candidate)
                break
        else:
            clusters.append([candidate])
    return clusters
