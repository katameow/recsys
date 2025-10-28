from __future__ import annotations

import logging
import time
import uuid

import jwt  # type: ignore[import]
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.app import config
from backend.app.auth.rate_limiting import guest_token_rate_limit, limiter
from backend.app.utils.observability import record_guest_token_metric

logger = logging.getLogger("auth.guest_token")

router = APIRouter(prefix="/auth", tags=["auth"])


class GuestUserModel(BaseModel):
    role: str = "guest"
    id: str | None = None
    name: str | None = None
    email: str | None = None
    image: str | None = None


class GuestTokenResponse(BaseModel):
    accessToken: str
    expiresAt: int
    user: GuestUserModel


@router.post("/guest", response_model=GuestTokenResponse)
@limiter.limit(guest_token_rate_limit)
async def issue_guest_token(request: Request) -> JSONResponse:
    if not config.APP_JWT_SECRET:
        record_guest_token_metric("failure")
        logger.error(
            "Guest token secret missing",
            extra={
                "json_fields": {
                    "event": "guest_token_error",
                    "reason": "secret_missing",
                    "client": request.client.host if request.client else None,
                }
            },
        )
        raise HTTPException(status_code=500, detail="Guest token signing secret is not configured")

    issued_at = int(time.time())
    expires_at = issued_at + config.GUEST_ACCESS_TOKEN_TTL_SECONDS
    subject = f"guest:{uuid.uuid4()}"

    payload = {
        "sub": subject,
        "role": "guest",
        "iss": config.APP_JWT_ISSUER,
        "aud": config.APP_JWT_AUDIENCE,
        "iat": issued_at,
        "exp": expires_at,
        "sid": subject,
    }

    token = jwt.encode(payload, config.APP_JWT_SECRET, algorithm=config.APP_JWT_ALGORITHM)

    response_model = GuestTokenResponse(
        accessToken=token,
        expiresAt=expires_at * 1000,
        user=GuestUserModel(id=subject, role="guest"),
    )

    logger.info(
        "Guest token issued",
        extra={
            "json_fields": {
                "event": "guest_token_issued",
                "subject": subject,
                "expiresAt": expires_at,
                "client": request.client.host if request.client else None,
            }
        },
    )
    record_guest_token_metric("success")

    return JSONResponse(status_code=200, content=response_model.model_dump())
