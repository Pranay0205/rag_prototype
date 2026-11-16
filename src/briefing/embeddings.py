"""ING-10 local embeddings (fastembed, bge-small). Model loaded once per process."""

from functools import lru_cache

import numpy as np

from briefing.config import EMBED_MODEL, MODEL_CACHE


@lru_cache(maxsize=1)
def _model():
    from fastembed import TextEmbedding  # imported lazily: ~2.7 s load

    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    return TextEmbedding(EMBED_MODEL, cache_dir=str(MODEL_CACHE))


def embed_documents(texts: list[str]) -> np.ndarray:
    return _normalize(np.array(list(_model().embed(texts)), dtype=np.float32))


def embed_queries(texts: list[str]) -> np.ndarray:
    """Queries use the model's retrieval prefix (query_embed), documents do not."""
    return _normalize(np.array(list(_model().query_embed(texts)), dtype=np.float32))


def _normalize(m: np.ndarray) -> np.ndarray:
    return m / np.clip(np.linalg.norm(m, axis=1, keepdims=True), 1e-12, None)
