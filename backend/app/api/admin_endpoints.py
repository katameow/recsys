from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.app.auth.dependencies import AuthContext, require_admin_user
from backend.app.core.search_service import SearchService
from backend.app.dependencies import get_search_service_dep
from backend.app.schemas.cache import (
    PrecomputedDeleteResponse,
    PrecomputedIndexResponse,
    PrecomputedUpsertRequest,
    PrecomputedEntry,
)
from backend.app.utils import cache_utils

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/status")
async def admin_status(auth: AuthContext = Depends(require_admin_user)) -> dict[str, str]:
    """Simple admin health endpoint protected by role-based access control."""

    return {"status": "ok", "subject": auth.subject, "role": auth.role}


def _ensure_cache_enabled(service: SearchService) -> None:
    if not service.cache_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Response cache is disabled",
        )


@router.get(
    "/cache/precomputed",
    response_model=PrecomputedIndexResponse,
    dependencies=[Depends(require_admin_user)],
)
async def list_precomputed_cache(
    service: SearchService = Depends(get_search_service_dep),
) -> PrecomputedIndexResponse:
    _ensure_cache_enabled(service)
    index = await service.list_precomputed_responses()
    items = [
        PrecomputedEntry(slug=slug, query=entry.get("query", ""), hash=entry.get("hash", ""))
        for slug, entry in sorted(index.items())
    ]
    return PrecomputedIndexResponse(items=items)


@router.put(
    "/cache/precomputed",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_user)],
)
async def upsert_precomputed_cache(
    payload: PrecomputedUpsertRequest,
    service: SearchService = Depends(get_search_service_dep),
) -> None:
    _ensure_cache_enabled(service)
    await service.store_precomputed_response(
        slug=payload.slug,
        query=payload.query,
        response=payload.response,
        ttl_seconds=payload.ttl_seconds,
    )
    await service.store_canonical_response(
        slug=payload.slug,
        query=payload.query,
        response=payload.response,
    )


@router.delete(
    "/cache/precomputed/{slug}",
    response_model=PrecomputedDeleteResponse,
    dependencies=[Depends(require_admin_user)],
)
async def delete_precomputed_cache(
    slug: str,
    query: str | None = None,
    service: SearchService = Depends(get_search_service_dep),
) -> PrecomputedDeleteResponse:
    _ensure_cache_enabled(service)
    index = await service.list_precomputed_responses()
    entry = index.get(slug)
    canonical_query = cache_utils.canonicalize_query(query) if query else (entry.get("query") if entry else None)
    removed = await service.delete_precomputed_response(slug, query=canonical_query)
    return PrecomputedDeleteResponse(slug=slug, removed=removed, query=canonical_query)
