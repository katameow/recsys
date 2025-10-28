"""Backend application package bootstrap.

This module ensures environment variables defined in the repository's `.env`
files are loaded before the rest of the application imports configuration
values. Loading eagerly prevents scenarios where `config.py` captures default
values because the runtime hasn't sourced the dotenv files yet (for example
when running `uvicorn` directly).
"""

from __future__ import annotations

import importlib
import importlib.util
import os
from pathlib import Path


def _load_dotenv_files() -> None:
	spec = importlib.util.find_spec("dotenv")
	if spec is None:  # pragma: no cover - optional dependency path
		return

	load_dotenv = importlib.import_module("dotenv").load_dotenv  # type: ignore[attr-defined]

	repo_root = Path(__file__).resolve().parents[2]
	candidates = (
		repo_root / "backend" / ".env",
		repo_root / "backend" / ".env.local",
		repo_root / ".env",
	)

	for candidate in candidates:
		if candidate.exists():
			load_dotenv(dotenv_path=candidate, override=False)


_load_dotenv_files()

# Ensure caching respects the dotenv configuration by defaulting to enabled when
# the corresponding environment variable is set in any dotenv file. We avoid
# mutating the environment if the user already made an explicit choice.
os.environ.setdefault("ENABLE_CACHE", os.environ.get("ENABLE_CACHE", "false"))

__all__ = []
