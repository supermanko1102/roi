from __future__ import annotations

import csv
import tempfile
import zipfile
from datetime import date, datetime
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from psycopg import Connection

from .config import get_settings

CITY_BUILDCASE_FILES = {
    "臺北市": "a_lvr_buildcase.csv",
    "新北市": "f_lvr_buildcase.csv",
    "桃園市": "h_lvr_buildcase.csv",
}
BUILDCASE_URL = (
    "https://plvr.land.moi.gov.tw/Download"
    "?type=zip&PayType=saleremark&fileName=lvr_buildcasecsv.zip"
)
BUILDCASE_CACHE = Path(tempfile.gettempdir()) / "project-address-agent" / "buildcase"


def _buildcase_path(*, filename: str, repo_root: Path) -> Path | None:
    local_path = repo_root / "etl" / "downloads" / "buildcase" / filename
    if local_path.exists():
        return local_path
    cached_path = BUILDCASE_CACHE / filename
    if cached_path.exists():
        return cached_path
    try:
        response = httpx.get(
            BUILDCASE_URL,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Referer": "https://plvr.land.moi.gov.tw/DownloadOpenData",
            },
            timeout=30,
            follow_redirects=True,
        )
        response.raise_for_status()
        with zipfile.ZipFile(BytesIO(response.content)) as archive:
            names = {Path(name).name.lower(): name for name in archive.namelist()}
            BUILDCASE_CACHE.mkdir(parents=True, exist_ok=True)
            for wanted in CITY_BUILDCASE_FILES.values():
                entry = names.get(wanted.lower())
                if entry is not None:
                    (BUILDCASE_CACHE / wanted).write_bytes(archive.read(entry))
            return cached_path if cached_path.exists() else None
    except (httpx.HTTPError, OSError, zipfile.BadZipFile):
        return None


def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    return value


def _find_column(headers: list[str], *needles: str) -> int:
    return next(
        (
            index
            for index, header in enumerate(headers)
            if all(needle in header for needle in needles)
        ),
        -1,
    )


def _read_buildcase_rows(
    *,
    city: str,
    district: str,
    project_name: str,
    repo_root: Path,
) -> list[dict[str, Any]]:
    filename = CITY_BUILDCASE_FILES.get(city)
    if filename is None:
        return []
    path = _buildcase_path(filename=filename, repo_root=repo_root)
    if path is None:
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if len(rows) < 2:
        return []
    headers = rows[0]
    data_rows = rows[2:] if len(rows) > 1 else []
    name_index = _find_column(headers, "建案名稱")
    district_index = _find_column(headers, "鄉鎮市區")
    street_index = _find_column(headers, "坐落街道")
    land_index = _find_column(headers, "坐落基地")
    case_index = _find_column(headers, "編號")
    permit_index = _find_column(headers, "建造執照")
    if name_index < 0 or district_index < 0:
        return []
    matches: list[dict[str, Any]] = []
    for row in data_rows:
        padded = [*row, *([""] * max(0, len(headers) - len(row)))]
        if padded[district_index].strip() != district:
            continue
        raw_name = padded[name_index].strip()
        exact = raw_name == project_name
        wildcard = (
            "?" in raw_name
            and len(raw_name) == len(project_name)
            and all(
                expected == "?" or expected == actual
                for expected, actual in zip(raw_name, project_name, strict=True)
            )
        )
        if not exact and not wildcard:
            continue
        matches.append(
            {
                "case_no": padded[case_index].strip() if case_index >= 0 else "",
                "name": raw_name,
                "street": padded[street_index].strip() if street_index >= 0 else "",
                "land_lot": padded[land_index].strip() if land_index >= 0 else "",
                "permit_no": padded[permit_index].strip() if permit_index >= 0 else "",
                "match": "exact" if exact else "wildcard",
                "source_file": str(path),
            }
        )
    return matches


def collect_project_evidence(
    conn: Connection[dict[str, Any]],
    *,
    city: str,
    district: str,
    project_name: str,
) -> dict[str, Any]:
    transactions = conn.execute(
        """
        SELECT address, count(*)::int AS deal_count,
               count(*) FILTER (WHERE is_cancelled IS TRUE)::int AS cancelled_count,
               min(deal_date) AS first_deal,
               max(deal_date) AS last_deal
        FROM presale_deals
        WHERE city = %s AND district = %s AND project_name = %s
        GROUP BY address
        ORDER BY deal_count DESC, address NULLS LAST
        """,
        (city, district, project_name),
    ).fetchall()
    communities = conn.execute(
        """
        SELECT case_no, name, street, permit_no, households,
               first_reg, declare_date, use_issue_date
        FROM communities
        WHERE city = %s AND district = %s AND name = %s
        ORDER BY case_no
        """,
        (city, district, project_name),
    ).fetchall()
    contracts = conn.execute(
        """
        SELECT mlvr_case_no, pdf_url, version_note, status, fetched_at
        FROM contract_materials
        WHERE city = %s AND district = %s AND project_name = %s
        """,
        (city, district, project_name),
    ).fetchall()
    project = conn.execute(
        """
        SELECT id, lat::float8 AS lat, lng::float8 AS lng,
               deal_count, cancel_count, is_demo
        FROM projects
        WHERE city = %s AND district = %s AND name = %s
        """,
        (city, district, project_name),
    ).fetchone()

    candidate_values = {str(row["address"]).strip() for row in transactions if row["address"]}
    candidate_values.update(str(row["street"]).strip() for row in communities if row["street"])
    cache_keys = [f"proj|{city}|{district}|{value}" for value in candidate_values]
    cached = (
        conn.execute(
            """
            SELECT addr_key, lat::float8 AS lat, lng::float8 AS lng,
                   precision, queried_at
            FROM geocode_cache
            WHERE addr_key = ANY(%s)
            ORDER BY addr_key
            """,
            (cache_keys,),
        ).fetchall()
        if cache_keys
        else []
    )
    buildcase = _read_buildcase_rows(
        city=city,
        district=district,
        project_name=project_name,
        repo_root=get_settings().repo_root,
    )
    return _jsonable(
        {
            "project": {
                "city": city,
                "district": district,
                "project_name": project_name,
                "row": project,
            },
            "transaction_addresses": transactions,
            "moi_communities": communities,
            "moi_buildcase_rows": buildcase,
            "contract_records": contracts,
            "geocode_cache": cached,
            "source_priority": [
                "transaction_addresses",
                "moi_communities",
                "moi_buildcase_rows",
                "contract_records",
            ],
        }
    )
