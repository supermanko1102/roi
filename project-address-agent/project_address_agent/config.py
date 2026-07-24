from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PACKAGE_DIR = Path(__file__).resolve().parent
AGENT_ROOT = PACKAGE_DIR.parent

load_dotenv(AGENT_ROOT / ".env")
load_dotenv(PACKAGE_DIR / ".env")
load_dotenv(AGENT_ROOT.parent / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    repo_root: Path
    model: str
    allow_publish: bool
    nlsc_timeout_seconds: float = 8.0


def get_settings() -> Settings:
    repo_root = Path(os.getenv("ROI_REPO_ROOT", AGENT_ROOT.parent)).expanduser().resolve()
    return Settings(
        database_url=os.getenv(
            "DATABASE_URL",
            "postgres://roi:roi@localhost:5432/taoyuan_roi",
        ),
        repo_root=repo_root,
        model=os.getenv("ADDRESS_AGENT_MODEL", "gemini-3-flash-preview"),
        allow_publish=os.getenv("ADDRESS_AGENT_ALLOW_PUBLISH", "0") == "1",
    )
