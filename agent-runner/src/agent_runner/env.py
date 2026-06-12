"""Centralized env loading. Call load_env() once at process start."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


def project_root() -> Path:
    """Returns agent-runner/ directory (the package's project root)."""
    return Path(__file__).resolve().parent.parent.parent


def site_data_dir() -> Path:
    """Where to write JSON the site reads — defaults to ../src/data."""
    cfg = os.environ.get("SITE_DATA_DIR")
    if cfg:
        p = Path(cfg)
    else:
        p = project_root().parent / "src" / "data"
    return p.resolve()


def load_env() -> None:
    env_path = project_root() / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)


def require(key: str) -> str:
    val = os.environ.get(key)
    if not val:
        raise RuntimeError(
            f"missing required env var {key}. Set it in agent-runner/.env "
            f"(see .env.example)."
        )
    return val
