"""Response models for search endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional
from pydantic import BaseModel, Field

from backend.app.schemas.llm_outputs import ProductAnalysis


class ProductReview(BaseModel):
    content: str
    rating: Optional[int] = None
    verified_purchase: Optional[bool] = None
    user_id: Optional[str] = None
    timestamp: Optional[datetime] = None
    similarity: Optional[float] = None
    has_rating: Optional[int] = None


class ProductSearchResult(BaseModel):
    asin: str
    product_title: str
    cleaned_item_description: str
    product_categories: str
    similarity: Optional[float] = None
    avg_rating: Optional[float] = None
    rating_count: Optional[int] = None
    displayed_rating: Optional[str] = None
    combined_score: Optional[float] = None
    reviews: List[ProductReview] = Field(default_factory=list)
    analysis: Optional[ProductAnalysis] = None


class SearchResponse(BaseModel):
    query: str
    count: int
    results: List[ProductSearchResult]


class SearchInitRequest(BaseModel):
    query: str
    products_k: int = Field(default=3, ge=1, le=50)
    reviews_per_product: int = Field(default=3, ge=0, le=25)


class SearchInitResponse(BaseModel):
    query_hash: str
    canonical_query: str
    products_k: int
    reviews_per_product: int


class SearchRequest(BaseModel):
    query: str
    query_hash: Optional[str] = None
    products_k: int = Field(default=3, ge=1, le=50)
    reviews_per_product: int = Field(default=3, ge=0, le=25)
    bypass_cache: bool = False


class SearchAcceptedResponse(BaseModel):
    query_hash: str
    result_url: str
    timeline_url: str
    status: Literal["pending"] = "pending"


class SearchResultEnvelope(BaseModel):
    query_hash: str
    status: Literal["pending", "completed", "failed"]
    result: Optional[SearchResponse] = None
    error: Optional[str] = None
    updated_at: Optional[datetime] = None


__all__ = [
    "ProductReview",
    "ProductSearchResult",
    "SearchResponse",
    "SearchInitRequest",
    "SearchInitResponse",
    "SearchRequest",
    "SearchAcceptedResponse",
    "SearchResultEnvelope",
]
