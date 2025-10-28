from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from backend.app.schemas.search import SearchResponse


class PrecomputedEntry(BaseModel):
    slug: str
    query: str
    hash: str


class PrecomputedIndexResponse(BaseModel):
    items: List[PrecomputedEntry] = Field(default_factory=list)


class PrecomputedUpsertRequest(BaseModel):
    slug: str
    query: str
    response: SearchResponse
    ttl_seconds: Optional[int] = None


class PrecomputedDeleteResponse(BaseModel):
    slug: str
    removed: bool
    query: Optional[str] = None
