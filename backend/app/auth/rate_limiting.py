from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter  # type: ignore[import]
from slowapi.errors import RateLimitExceeded  # type: ignore[import]
from slowapi.util import get_remote_address  # type: ignore[import]

from backend.app import config


def _rate_limit_key(request: Request) -> str:
    auth = getattr(request.state, "auth", None)
    if auth and getattr(auth, "subject", None):
        return f"user:{auth.subject}"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # A comma-separated chain of IPs may be present; use the originating address.
        return f"ip:{forwarded.split(',')[0].strip()}"
    return get_remote_address(request)


limiter = Limiter(key_func=_rate_limit_key, headers_enabled=True)


def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    retry_after = exc.reset_in if hasattr(exc, "reset_in") else None
    headers = {"Retry-After": str(int(retry_after))} if retry_after else {}
    return JSONResponse(status_code=429, content={"detail": "Rate limit exceeded"}, headers=headers)


def search_rate_limit(request: Request | None = None) -> str:
    context = getattr(request.state, "auth", None) if request else None
    role = getattr(context, "role", None) if context else None

    if role and role.lower() == "admin":
        return config.ADMIN_SEARCH_RATE_LIMIT
    if role and role.lower() == "guest":
        return config.GUEST_SEARCH_RATE_LIMIT
    return config.USER_SEARCH_RATE_LIMIT


def guest_token_rate_limit() -> str:
    return config.GUEST_SESSION_RATE_LIMIT
