"""Lightweight smoke checks for the FastAPI application.

This script exercises the root endpoint and the guest token issuance flow
using FastAPI's TestClient so we can validate critical integrations without
running the ASGI server.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

os.environ.setdefault("APP_JWT_SECRET", "smoke-secret")

from backend.app.main import app  # type: ignore[import]


def main() -> None:
    client = TestClient(app)

    root_response = client.get("/")
    print("/ status", root_response.status_code, root_response.json())

    guest_response = client.post("/auth/guest")
    print("/auth/guest status", guest_response.status_code)
    print("guest payload keys", sorted(guest_response.json().keys()))


if __name__ == "__main__":
    main()
