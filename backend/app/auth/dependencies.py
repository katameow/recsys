from __future__ import annotations

from typing import Any, Optional

import jwt  # type: ignore[import]
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import InvalidAudienceError, InvalidIssuerError, InvalidTokenError  # type: ignore[import]

from backend.app import config
from backend.app.auth.schemas import AuthContext
from backend.app.security.refresh_store import get_refresh_store

_bearer_scheme = HTTPBearer(auto_error=False)


def _get_app_secret() -> str:
    if not config.APP_JWT_SECRET:
        raise RuntimeError("APP_JWT_SECRET environment variable is not configured")
    return config.APP_JWT_SECRET


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


async def _decode_token(token: str) -> AuthContext:
    secret = _get_app_secret()
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            secret,
            algorithms=[config.APP_JWT_ALGORITHM],
            audience=config.APP_JWT_AUDIENCE,
            issuer=config.APP_JWT_ISSUER,
            options={
                "require": ["exp", "iat", "sub"],
            },
        )
    except InvalidAudienceError as exc:
        raise _unauthorized("Invalid token audience") from exc
    except InvalidIssuerError as exc:
        raise _unauthorized("Invalid token issuer") from exc
    except InvalidTokenError as exc:
        raise _unauthorized("Invalid authentication credentials") from exc

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise _unauthorized("Invalid token subject")

    role = payload.get("role", "user")
    if not isinstance(role, str):
        role = str(role)

    email = payload.get("email")
    if not isinstance(email, str):
        email = None

    refresh_hash = payload.get("rid")
    if not isinstance(refresh_hash, str):
        refresh_hash = None

    session_id = payload.get("sid")
    if not isinstance(session_id, str):
        session_id = None

    issued_at = payload.get("iat")
    if isinstance(issued_at, str) and issued_at.isdigit():
        issued_at = int(issued_at)
    elif not isinstance(issued_at, (int, type(None))):
        issued_at = None

    expires_at = payload.get("exp")
    if isinstance(expires_at, str) and expires_at.isdigit():
        expires_at = int(expires_at)
    elif not isinstance(expires_at, (int, type(None))):
        expires_at = None

    if refresh_hash:
        refresh_store = get_refresh_store()
        if await refresh_store.is_refresh_hash_revoked(refresh_hash):
            raise _unauthorized("Refresh token has been revoked")

    return AuthContext(
        subject=subject,
        role=role,
        email=email,
        refresh_hash=refresh_hash,
        session_id=session_id,
        issued_at=issued_at,
        expires_at=expires_at,
        raw_token=token,
        claims=payload,
    )


async def require_authenticated_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> AuthContext:
    if credentials is None:
        raise _unauthorized("Missing bearer token")

    context = await _decode_token(credentials.credentials)
    request.state.auth = context
    return context


async def require_admin_user(
    request: Request,
    context: AuthContext = Depends(require_authenticated_user),
) -> AuthContext:
    if context.role.lower() != "admin":
        raise _forbidden("Admin privileges required")
    request.state.auth = context
    return context


async def optional_authenticated_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[AuthContext]:
    if credentials is None:
        return None

    try:
        context = await _decode_token(credentials.credentials)
    except HTTPException:
        return None

    request.state.auth = context
    return context
