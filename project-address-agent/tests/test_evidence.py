from __future__ import annotations

import zipfile
from io import BytesIO

import httpx

from project_address_agent import evidence


def test_missing_buildcase_file_downloads_to_ephemeral_cache(
    monkeypatch,
    tmp_path,
) -> None:
    archive_bytes = BytesIO()
    with zipfile.ZipFile(archive_bytes, "w") as archive:
        archive.writestr("h_lvr_buildcase.csv", "建案名稱,鄉鎮市區\n測試案,桃園區\n")
    response = httpx.Response(
        200,
        content=archive_bytes.getvalue(),
        request=httpx.Request("GET", evidence.BUILDCASE_URL),
    )
    monkeypatch.setattr(evidence, "BUILDCASE_CACHE", tmp_path / "cache")
    monkeypatch.setattr(evidence.httpx, "get", lambda *_, **__: response)

    path = evidence._buildcase_path(
        filename="h_lvr_buildcase.csv",
        repo_root=tmp_path / "repo",
    )

    assert path == tmp_path / "cache" / "h_lvr_buildcase.csv"
    assert path.read_text(encoding="utf-8").startswith("建案名稱")
