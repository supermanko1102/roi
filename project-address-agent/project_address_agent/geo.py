from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _on_segment(
    lng: float,
    lat: float,
    a: list[float],
    b: list[float],
    epsilon: float = 1e-10,
) -> bool:
    cross = (lng - a[0]) * (b[1] - a[1]) - (lat - a[1]) * (b[0] - a[0])
    if abs(cross) > epsilon:
        return False
    return (
        min(a[0], b[0]) - epsilon <= lng <= max(a[0], b[0]) + epsilon
        and min(a[1], b[1]) - epsilon <= lat <= max(a[1], b[1]) + epsilon
    )


def point_in_ring(lng: float, lat: float, ring: list[list[float]]) -> bool:
    if len(ring) < 3:
        return False
    inside = False
    previous = ring[-1]
    for current in ring:
        if _on_segment(lng, lat, previous, current):
            return True
        x1, y1 = previous
        x2, y2 = current
        if (y1 > lat) != (y2 > lat):
            crossing_lng = (x2 - x1) * (lat - y1) / (y2 - y1) + x1
            if lng < crossing_lng:
                inside = not inside
        previous = current
    return inside


def point_in_polygon(lng: float, lat: float, polygon: list[list[list[float]]]) -> bool:
    if not polygon or not point_in_ring(lng, lat, polygon[0]):
        return False
    return not any(point_in_ring(lng, lat, hole) for hole in polygon[1:])


def point_in_geometry(lng: float, lat: float, geometry: dict[str, Any]) -> bool:
    if geometry.get("type") == "Polygon":
        return point_in_polygon(lng, lat, geometry["coordinates"])
    if geometry.get("type") == "MultiPolygon":
        return any(point_in_polygon(lng, lat, polygon) for polygon in geometry["coordinates"])
    return False


class DistrictIndex:
    def __init__(self, geojson_path: Path):
        payload = json.loads(geojson_path.read_text(encoding="utf-8"))
        self._geometries = {
            (str(feature["properties"]["city"]), str(feature["properties"]["name"])): feature[
                "geometry"
            ]
            for feature in payload.get("features", [])
        }

    def infer_district(self, *, city: str, text: str) -> str | None:
        matches = [
            district
            for candidate_city, district in self._geometries
            if candidate_city == city and district in text
        ]
        return matches[0] if len(matches) == 1 else None

    def contains(
        self,
        *,
        city: str,
        district: str,
        lat: float,
        lng: float,
    ) -> bool:
        geometry = self._geometries.get((city, district))
        return bool(geometry and point_in_geometry(lng, lat, geometry))
