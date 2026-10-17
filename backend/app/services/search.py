"""Búsqueda híbrida: texto completo (palabras) + vectores (significado) + filtros.

"seguro de coche 2024" se interpreta como texto "seguro de coche" con el
filtro año = 2024. Las dos búsquedas se combinan con Reciprocal Rank Fusion.
"""

import html
import re
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.embeddings import embed_query

RRF_K = 60
CANDIDATES = 50
# Los resultados solo semánticos por encima de esta distancia coseno se descartan.
MAX_SEMANTIC_DISTANCE = 0.75

_YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")


@dataclass
class ParsedQuery:
    text: str
    years: list[int] = field(default_factory=list)


@dataclass
class Hit:
    item_id: uuid.UUID
    score: float
    chunk_id: int
    keyword_rank: int | None = None
    semantic_rank: int | None = None
    snippet: str = ""


def parse_query(q: str) -> ParsedQuery:
    years = sorted({int(y) for y in _YEAR_RE.findall(q)})
    rest = _YEAR_RE.sub(" ", q)
    return ParsedQuery(text=" ".join(rest.split()), years=years)


def _filters(years: list[int], category: str | None) -> tuple[str, dict]:
    clauses, params = ["i.status = 'ready'"], {}
    if years:
        clauses.append("i.year = ANY(:years)")
        params["years"] = years
    if category:
        clauses.append("i.category = :category")
        params["category"] = category
    return " AND ".join(clauses), params


def _keyword(db: Session, query_text: str, where: str, params: dict) -> list[tuple]:
    # plainto_tsquery exige todas las palabras; cambiamos & por | para que
    # coincidir con más palabras puntúe más pero no sea obligatorio.
    sql = f"""
        WITH query AS (
            SELECT replace(plainto_tsquery('spanish', immutable_unaccent(:q))::text, '&', '|')::tsquery AS tq
        ),
        best AS (
            SELECT DISTINCT ON (c.item_id) c.item_id, c.id AS chunk_id, ts_rank_cd(c.tsv, query.tq) AS rank
            FROM chunks c JOIN items i ON i.id = c.item_id, query
            WHERE c.tsv @@ query.tq AND {where}
            ORDER BY c.item_id, rank DESC
        )
        SELECT item_id, chunk_id FROM best ORDER BY rank DESC LIMIT {CANDIDATES}
    """
    return list(db.execute(text(sql), {"q": query_text, **params}))


def _semantic(db: Session, query_text: str, where: str, params: dict) -> list[tuple]:
    vector = "[" + ",".join(f"{v:.6f}" for v in embed_query(query_text)) + "]"
    sql = f"""
        WITH nearest AS (
            SELECT c.item_id, c.id AS chunk_id, c.embedding <=> CAST(:vec AS vector) AS dist
            FROM chunks c JOIN items i ON i.id = c.item_id
            WHERE {where}
            ORDER BY dist LIMIT 200
        ),
        best AS (
            SELECT DISTINCT ON (item_id) item_id, chunk_id, dist FROM nearest ORDER BY item_id, dist
        )
        SELECT item_id, chunk_id, dist FROM best ORDER BY dist LIMIT {CANDIDATES}
    """
    return list(db.execute(text(sql), {"vec": vector, **params}))


def _snippets(db: Session, hits: list[Hit], query_text: str) -> None:
    if not hits:
        return
    rows = db.execute(
        text("""
            SELECT id, ts_headline('spanish', content,
                       plainto_tsquery('spanish', immutable_unaccent(:q)),
                       'MaxWords=30, MinWords=12, StartSel=⟦, StopSel=⟧, MaxFragments=2') AS snippet
            FROM chunks WHERE id = ANY(:ids)
        """),
        {"q": query_text or "", "ids": [h.chunk_id for h in hits]},
    )
    # El texto viene de tus documentos y puede contener HTML: se escapa todo
    # y solo después se convierten las marcas propias en <mark>.
    by_id = {
        r.id: html.escape(r.snippet).replace("⟦", "<mark>").replace("⟧", "</mark>")
        for r in rows
    }
    for h in hits:
        h.snippet = by_id.get(h.chunk_id, "")


def search(db: Session, q: str, category: str | None = None, limit: int = 20) -> tuple[ParsedQuery, list[Hit]]:
    parsed = parse_query(q)
    hits = _search(db, parsed, parsed.years, category, limit)
    if not hits and parsed.years and parsed.text:
        # Si nada tiene ese año, mejor mostrar lo más parecido que nada.
        hits = _search(db, parsed, [], category, limit)
    _snippets(db, hits, parsed.text)
    return parsed, hits


def _search(db: Session, parsed: ParsedQuery, years: list[int], category: str | None, limit: int) -> list[Hit]:
    where, params = _filters(years, category)

    if not parsed.text:
        # Solo filtros ("2024"): lo más reciente primero.
        rows = db.execute(
            text(f"""
                SELECT i.id AS item_id, (SELECT c.id FROM chunks c WHERE c.item_id = i.id ORDER BY c.ord LIMIT 1) AS chunk_id
                FROM items i WHERE {where} ORDER BY i.doc_date DESC NULLS LAST, i.created_at DESC LIMIT :limit
            """),
            {**params, "limit": limit},
        )
        return [Hit(item_id=r.item_id, chunk_id=r.chunk_id, score=0.0) for r in rows if r.chunk_id]

    hits: dict[uuid.UUID, Hit] = {}
    for rank, row in enumerate(_keyword(db, parsed.text, where, params), start=1):
        hits[row.item_id] = Hit(row.item_id, 1 / (RRF_K + rank), row.chunk_id, keyword_rank=rank)

    for rank, row in enumerate(_semantic(db, parsed.text, where, params), start=1):
        hit = hits.get(row.item_id)
        if hit:
            hit.score += 1 / (RRF_K + rank)
            hit.semantic_rank = rank
        elif row.dist <= MAX_SEMANTIC_DISTANCE:
            hits[row.item_id] = Hit(row.item_id, 1 / (RRF_K + rank), row.chunk_id, semantic_rank=rank)

    return sorted(hits.values(), key=lambda h: h.score, reverse=True)[:limit]
