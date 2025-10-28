from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict

import jwt  # type: ignore[import]

# Ensure repository root is on sys.path so `import backend.*` works when running this file directly
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.append(str(REPO_ROOT))

# Provide a default signing secret for local testing if not set
os.environ.setdefault("APP_JWT_SECRET", "dev-secret")

from backend.app import config


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Generate a signed JWT for local testing")
    p.add_argument("--role", default="user", choices=["guest", "user", "admin"], help="Role claim")
    p.add_argument("--sub", default=None, help="Subject claim (defaults to role:<uuid-like>")
    p.add_argument("--ttl", type=int, default=3600, help="Token TTL in seconds (default: 3600)")
    p.add_argument("--email", default=None, help="Optional email claim")
    return p.parse_args()


def main() -> int:
    args = _parse_args()

    secret = config.APP_JWT_SECRET or os.environ.get("APP_JWT_SECRET")
    if not secret:
        print("ERROR: APP_JWT_SECRET must be set in env or backend.app.config")
        return 1

    issued_at = int(time.time())
    expires_at = issued_at + max(1, int(args.ttl))

    subject = args.sub or f"{args.role}:local"

    payload: Dict[str, Any] = {
        "sub": subject,
        "role": args.role,
        "iss": config.APP_JWT_ISSUER,
        "aud": config.APP_JWT_AUDIENCE,
        "iat": issued_at,
        "exp": expires_at,
        "sid": subject,
    }
    if args.email:
        payload["email"] = args.email

    token = jwt.encode(payload, secret, algorithm=config.APP_JWT_ALGORITHM)
    print(token)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
