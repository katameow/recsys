from __future__ import annotations

import sys
from pathlib import Path

import pytest  # type: ignore[import]

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.core.search_engine import SearchEngine
from backend.app.db.bigquery_client import BigQueryClient


class _StubVertexClient:
    async def get_embeddings(self, query: str):  # pragma: no cover - should be overridden
        raise NotImplementedError


@pytest.mark.asyncio
async def test_hybrid_search_selects_embedding_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_sql: dict[str, str] = {}

    async def fake_execute_query(self, query: str, timeout: int = 30, retries: int = 2):
        captured_sql["sql"] = query
        return []

    async def fake_generate_embedding(self, query: str):
        return [0.1, 0.2]

    monkeypatch.setattr(BigQueryClient, "execute_query", fake_execute_query, raising=False)
    monkeypatch.setattr(SearchEngine, "_generate_query_embedding", fake_generate_embedding, raising=False)

    engine = SearchEngine(vertex_ai_client=_StubVertexClient())
    await engine.hybrid_search("coffee gift", products_k=1, reviews_per_product=1)

    assert "sql" in captured_sql
    sql = captured_sql["sql"]
    assert "product_categories,\n                        embedding" in sql
    assert "verified_purchase,\n                        embedding" in sql
