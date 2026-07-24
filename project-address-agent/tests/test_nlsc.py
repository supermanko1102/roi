from __future__ import annotations

from pathlib import Path
from typing import Any

from project_address_agent.config import Settings
from project_address_agent.nlsc import (
    NlscClient,
    nlsc_ssl_context,
    normalize_text,
    parse_cross_candidate,
    parse_land_lot,
    parse_text_query_xml,
)


class FakeResponse:
    def __init__(self, text: str):
        self.text = text

    def raise_for_status(self) -> None:
        return None


class FakeHttpClient:
    def __init__(self, responses: list[str]):
        self.responses = list(responses)
        self.urls: list[str] = []

    def get(self, url: str) -> FakeResponse:
        self.urls.append(url)
        if not self.responses:
            raise AssertionError(f"Unexpected HTTP request: {url}")
        return FakeResponse(self.responses.pop(0))


class FakeDistrictIndex:
    def __init__(self, contains: bool):
        self.result = contains

    def contains(self, **_: Any) -> bool:
        return self.result


def settings() -> Settings:
    return Settings(
        database_url="postgres://unused",
        repo_root=Path("/tmp/unused"),
        model="gemini-3-flash-preview",
        allow_publish=False,
    )


def item_xml(
    *,
    content: str = "桃園市桃園區中正路100號",
    key: str = "ADDRESS",
    location: str = "121.31,24.99",
    remark: str = "門牌",
) -> str:
    return (
        "<RESULT><ITEM>"
        f"<CONTENT>{content}</CONTENT>"
        f"<KEY>{key}</KEY>"
        f"<LOCATION>{location}</LOCATION>"
        f"<REMARK>{remark}</REMARK>"
        "</ITEM></RESULT>"
    )


def test_parses_text_query_xml() -> None:
    items = parse_text_query_xml(item_xml())
    assert len(items) == 1
    assert items[0].content == "桃園市桃園區中正路100號"
    assert items[0].key == "ADDRESS"
    assert items[0].lng == 121.31
    assert items[0].lat == 24.99


def test_normalizes_full_width_and_tai_variant() -> None:
    assert normalize_text("台北市 中正路１００號") == "臺北市中正路100號"


def test_nlsc_ssl_context_keeps_verification_enabled() -> None:
    context = nlsc_ssl_context()
    assert context.verify_mode.name == "CERT_REQUIRED"
    assert context.check_hostname


def test_parses_cross_and_land_lot() -> None:
    assert parse_cross_candidate("春日路與青溪二路口") == ("春日路", "青溪二路")
    assert parse_land_lot("三民段28-3地號") == ("三民段", "00280003")


def test_validates_exact_door_inside_district() -> None:
    http = FakeHttpClient([item_xml()])
    client = NlscClient(
        settings=settings(),
        http_client=http,  # type: ignore[arg-type]
        district_index=FakeDistrictIndex(True),  # type: ignore[arg-type]
    )
    result = client.validate(
        city="桃園市",
        district="桃園區",
        kind="door",
        candidate="中正路100號",
    )
    assert result.ok
    assert result.precision == "door"
    assert result.lat == 24.99
    assert result.lng == 121.31


def test_rejects_door_outside_district() -> None:
    client = NlscClient(
        settings=settings(),
        http_client=FakeHttpClient([item_xml()]),  # type: ignore[arg-type]
        district_index=FakeDistrictIndex(False),  # type: ignore[arg-type]
    )
    result = client.validate(
        city="桃園市",
        district="桃園區",
        kind="door",
        candidate="中正路100號",
    )
    assert not result.ok
    assert not result.in_district


def test_rejects_approximate_door_without_network() -> None:
    http = FakeHttpClient([])
    client = NlscClient(
        settings=settings(),
        http_client=http,  # type: ignore[arg-type]
        district_index=FakeDistrictIndex(True),  # type: ignore[arg-type]
    )
    result = client.validate(
        city="桃園市",
        district="桃園區",
        kind="door",
        candidate="中正路附近",
    )
    assert not result.ok
    assert http.urls == []
