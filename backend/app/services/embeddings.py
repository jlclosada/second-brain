"""Embeddings locales con fastembed (ONNX en CPU, sin coste ni clave de API)."""

import hashlib
import math
import re
from functools import lru_cache

from app.config import get_settings


@lru_cache
def _model():
    from fastembed import TextEmbedding

    settings = get_settings()
    settings.models_dir.mkdir(parents=True, exist_ok=True)
    return TextEmbedding(settings.embedding_model, cache_dir=str(settings.models_dir))


def _hash_embedding(text: str, dim: int) -> list[float]:
    """Embedding determinista por palabras. Solo para tests: no entiende sinónimos."""
    vec = [0.0] * dim
    for word in re.findall(r"\w+", text.lower()):
        h = int(hashlib.md5(word.encode()).hexdigest(), 16)
        vec[h % dim] += 1.0 if (h >> 8) % 2 else -1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def embed(texts: list[str]) -> list[list[float]]:
    settings = get_settings()
    if not texts:
        return []
    if settings.embeddings_provider == "hash":
        return [_hash_embedding(t, settings.embedding_dim) for t in texts]
    return [vec.tolist() for vec in _model().embed(texts)]


def embed_query(text: str) -> list[float]:
    return embed([text])[0]
