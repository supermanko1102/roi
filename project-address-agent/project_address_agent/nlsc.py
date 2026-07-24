from __future__ import annotations

import html
import re
import ssl
import time
import unicodedata
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
import truststore

from .config import Settings, get_settings
from .geo import DistrictIndex
from .models import CandidateKind, ValidationResult

TEXT_QUERY_URL = "https://api.nlsc.gov.tw/idc/TextQueryMap/"
CITY_CODES = {"臺北市": "A", "新北市": "F", "桃園市": "H"}


@dataclass(frozen=True)
class NlscItem:
    content: str
    key: str
    lng: float
    lat: float
    remark: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "key": self.key,
            "lng": self.lng,
            "lat": self.lat,
            "remark": self.remark,
        }


def normalize_text(value: str) -> str:
    return (
        unicodedata.normalize("NFKC", html.unescape(value))
        .replace("台北市", "臺北市")
        .replace("之", "-")
        .replace("－", "-")
        .replace(" ", "")
    )


def nlsc_ssl_context() -> ssl.SSLContext:
    # NLSC uses a certificate chain trusted by macOS but absent from some
    # Python CA bundles. Use the native trust store without disabling TLS.
    context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = True
    context.verify_mode = ssl.CERT_REQUIRED
    return context


def _xml_tag(block: str, name: str) -> str:
    match = re.search(rf"<{name}>(.*?)</{name}>", block, re.DOTALL)
    return html.unescape(match.group(1)).strip() if match else ""


def parse_text_query_xml(xml: str) -> list[NlscItem]:
    items: list[NlscItem] = []
    for block in re.findall(r"<ITEM>(.*?)</ITEM>", xml, re.DOTALL):
        try:
            lng, lat = (
                float(value) for value in _xml_tag(block, "LOCATION").split(",", maxsplit=1)
            )
        except (TypeError, ValueError):
            continue
        items.append(
            NlscItem(
                content=_xml_tag(block, "CONTENT"),
                key=_xml_tag(block, "KEY"),
                lng=lng,
                lat=lat,
                remark=_xml_tag(block, "REMARK"),
            )
        )
    return items


def parse_cross_candidate(candidate: str) -> tuple[str, str] | None:
    cleaned = re.sub(r"(?:交叉口|口)$", "", candidate.strip())
    parts = [part.strip() for part in re.split(r"\s*(?:與|和|及|、|/)\s*", cleaned) if part.strip()]
    return (parts[0], parts[1]) if len(parts) == 2 else None


def parse_land_lot(candidate: str) -> tuple[str, str] | None:
    match = re.search(
        r"([^\s,，、;；()（）]{1,12}?段(?:[^\s,，、;；()（）]{1,8}?小段)?)"
        r"\s*(\d{1,4})(?:[-之.](\d{1,4}))?\s*地號",
        candidate,
    )
    if not match:
        return None
    mother = match.group(2).zfill(4)
    child = (match.group(3) or "0").zfill(4)
    return match.group(1), mother + child


class NlscClient:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        http_client: httpx.Client | None = None,
        district_index: DistrictIndex | None = None,
    ):
        self.settings = settings or get_settings()
        self.http = http_client or httpx.Client(
            timeout=self.settings.nlsc_timeout_seconds,
            verify=nlsc_ssl_context(),
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://maps.nlsc.gov.tw/",
            },
        )
        self.district_index = district_index or DistrictIndex(
            self.settings.repo_root / "data" / "districts.geojson"
        )

    def _get_text(self, url: str) -> str:
        for attempt in range(3):
            try:
                response = self.http.get(url)
                response.raise_for_status()
                return response.text
            except httpx.HTTPError as error:
                if attempt == 2:
                    raise RuntimeError(f"NLSC request failed: {error}") from error
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError("NLSC request failed.")

    def close(self) -> None:
        self.http.close()

    def _query(self, query: str) -> list[NlscItem]:
        return parse_text_query_xml(self._get_text(TEXT_QUERY_URL + quote(query, safe="")))

    @staticmethod
    def _full_candidate(city: str, district: str, candidate: str) -> str:
        normalized = candidate.strip()
        if normalized.startswith(city):
            return normalized
        if normalized.startswith(district):
            return city + normalized
        return city + district + normalized

    def _finalize(
        self,
        *,
        city: str,
        district: str,
        kind: CandidateKind,
        candidate: str,
        item: NlscItem | None,
        payload: dict[str, Any],
    ) -> ValidationResult:
        if item is None:
            return ValidationResult(
                ok=False,
                kind=kind,
                candidate=candidate,
                precision=None,
                lat=None,
                lng=None,
                in_district=False,
                message="NLSC did not return an exact candidate.",
                provider_payload=payload,
            )
        in_district = self.district_index.contains(
            city=city,
            district=district,
            lat=item.lat,
            lng=item.lng,
        )
        return ValidationResult(
            ok=in_district,
            kind=kind,
            candidate=candidate,
            precision=kind,
            lat=item.lat,
            lng=item.lng,
            in_district=in_district,
            message=(
                "Candidate passed NLSC and district validation."
                if in_district
                else "NLSC returned a point outside the expected district."
            ),
            provider_payload={**payload, "matched_item": item.as_dict()},
        )

    def validate_door(
        self,
        *,
        city: str,
        district: str,
        candidate: str,
    ) -> ValidationResult:
        full = self._full_candidate(city, district, candidate)
        if "號" not in full:
            return self._finalize(
                city=city,
                district=district,
                kind="door",
                candidate=candidate,
                item=None,
                payload={"error": "Door candidate must contain 號."},
            )
        street_part = normalize_text(full)
        for prefix in (normalize_text(city + district), normalize_text(district)):
            if street_part.startswith(prefix):
                street_part = street_part[len(prefix) :]
                break
        items = self._query(full)
        hit = next(
            (
                item
                for item in items
                if "門牌" in item.remark
                and district in normalize_text(item.content)
                and normalize_text(item.content).endswith(street_part)
            ),
            None,
        )
        return self._finalize(
            city=city,
            district=district,
            kind="door",
            candidate=candidate,
            item=hit,
            payload={"query": full, "result_count": len(items)},
        )

    def validate_cross(
        self,
        *,
        city: str,
        district: str,
        candidate: str,
    ) -> ValidationResult:
        roads = parse_cross_candidate(candidate)
        if roads is None:
            return self._finalize(
                city=city,
                district=district,
                kind="cross",
                candidate=candidate,
                item=None,
                payload={"error": "Intersection must contain exactly two road names."},
            )
        all_items: list[NlscItem] = []
        for left, right in (roads, roads[::-1]):
            all_items.extend(self._query(f"{city}{district}{left}與{right}"))
        road_a, road_b = (normalize_text(road) for road in roads)
        hit = next(
            (
                item
                for item in all_items
                if "CROSSROAD" in item.key
                and road_a in normalize_text(item.key + item.content)
                and road_b in normalize_text(item.key + item.content)
            ),
            None,
        )
        return self._finalize(
            city=city,
            district=district,
            kind="cross",
            candidate=candidate,
            item=hit,
            payload={
                "queries": [
                    f"{city}{district}{roads[0]}與{roads[1]}",
                    f"{city}{district}{roads[1]}與{roads[0]}",
                ],
                "result_count": len(all_items),
            },
        )

    def validate_lot(
        self,
        *,
        city: str,
        district: str,
        candidate: str,
    ) -> ValidationResult:
        parsed = parse_land_lot(candidate)
        city_code = CITY_CODES.get(city)
        if parsed is None or city_code is None:
            return self._finalize(
                city=city,
                district=district,
                kind="lot",
                candidate=candidate,
                item=None,
                payload={"error": "Invalid city or land-lot candidate."},
            )
        section_name, number8 = parsed
        towns_xml = self._get_text(f"https://api.nlsc.gov.tw/other/ListTown/{city_code}")
        towns = dict(
            re.findall(
                r"<towncode>(\w+)</towncode>\s*<townname>([^<]+)</townname>",
                towns_xml,
            )
        )
        town_code = next((code for code, name in towns.items() if name == district), None)
        if town_code is None:
            return self._finalize(
                city=city,
                district=district,
                kind="lot",
                candidate=candidate,
                item=None,
                payload={"error": "NLSC town code not found."},
            )
        sections_xml = self._get_text(
            f"https://api.nlsc.gov.tw/other/ListLandSection/{city_code}/{town_code}"
        )
        sections = {
            name: (office, section_code)
            for office, section_code, name in re.findall(
                r"<office>(\w+)</office>.*?<sectcode>(\d+)</sectcode>"
                r"\s*<sectstr>([^<]+)</sectstr>",
                sections_xml,
                re.DOTALL,
            )
        }
        section = sections.get(section_name)
        if section is None:
            return self._finalize(
                city=city,
                district=district,
                kind="lot",
                candidate=candidate,
                item=None,
                payload={"error": f"NLSC section not found: {section_name}."},
            )
        office, section_code = section
        position_xml = self._get_text(
            f"https://api.nlsc.gov.tw/dmaps/CadasMapPosition/{office}/{section_code}/{number8}"
        )
        x_match = re.search(r"<repX>([\d.]+)</repX>", position_xml)
        y_match = re.search(r"<repY>([\d.]+)</repY>", position_xml)
        item = (
            NlscItem(
                content=candidate,
                key=f"LOT|{office}|{section_code}|{number8}",
                lng=float(x_match.group(1)),
                lat=float(y_match.group(1)),
                remark="地籍代表點",
            )
            if x_match and y_match
            else None
        )
        return self._finalize(
            city=city,
            district=district,
            kind="lot",
            candidate=candidate,
            item=item,
            payload={
                "town_code": town_code,
                "office": office,
                "section_code": section_code,
                "number8": number8,
            },
        )

    def validate(
        self,
        *,
        city: str,
        district: str,
        kind: CandidateKind,
        candidate: str,
    ) -> ValidationResult:
        if kind == "door":
            return self.validate_door(city=city, district=district, candidate=candidate)
        if kind == "cross":
            return self.validate_cross(city=city, district=district, candidate=candidate)
        if kind == "lot":
            return self.validate_lot(city=city, district=district, candidate=candidate)
        raise ValueError(f"Unsupported candidate kind: {kind}.")
