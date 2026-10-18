"""Búsqueda híbrida: texto completo (palabras) + vectores (significado) + filtros.

"seguro de coche 2024" se interpreta como texto "seguro de coche" con el
filtro año = 2024. Las dos búsquedas se combinan con Reciprocal Rank Fusion.
"""

import html
import re
import unicodedata
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
MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "sept": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
_MONTH_RE = re.compile(r"\b(" + "|".join(MONTHS) + r")\b", re.IGNORECASE)
# «06/2023», «6-2023» o «2023-06»
_NUMERIC_MONTH_RE = re.compile(r"\b(?:(0?[1-9]|1[0-2])[/\-.](19[5-9]\d|20[0-4]\d)|(19[5-9]\d|20[0-4]\d)-(0[1-9]|1[0-2]))\b")
_FILLER_RE = re.compile(r"\b(de|del|en|el|la|los|las)\b(?=\s*$)|^\s*(de|del)\b", re.IGNORECASE)


@dataclass
class ParsedQuery:
    text: str
    years: list[int] = field(default_factory=list)
    months: list[int] = field(default_factory=list)


@dataclass
class Hit:
    item_id: uuid.UUID
    score: float
    chunk_id: int
    keyword_rank: int | None = None
    semantic_rank: int | None = None
    snippet: str = ""


def parse_query(q: str) -> ParsedQuery:
    """«nómina de junio 2023» → texto «nómina», mes 6, año 2023."""
    months: set[int] = set()
    years: set[int] = set()
    for m in _NUMERIC_MONTH_RE.finditer(q):
        month, year = (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(3))
        months.add(int(month))
        years.add(int(year))
    rest = _NUMERIC_MONTH_RE.sub(" ", q)
    months |= {MONTHS[m.lower()] for m in _MONTH_RE.findall(rest)}
    rest = _MONTH_RE.sub(" ", rest)
    years |= {int(y) for y in _YEAR_RE.findall(rest)}
    rest = " ".join(_YEAR_RE.sub(" ", rest).split())
    rest = " ".join(_FILLER_RE.sub(" ", rest).split())
    return ParsedQuery(text=rest, years=sorted(years), months=sorted(months))


def _filters(years: list[int], category: str | None, kind: str | None = None,
             months: list[int] | None = None) -> tuple[str, dict]:
    clauses, params = ["i.status = 'ready'"], {}
    if months:
        # El mes del documento, o el mes nombrado en su título o resumen («Nómina junio 2023»).
        names = [name for name, n in MONTHS.items() if n in months]
        clauses.append(
            "(EXTRACT(MONTH FROM i.doc_date) = ANY(:months) OR "
            "immutable_unaccent(lower(i.title || ' ' || coalesce(i.summary, ''))) ~ :month_names)"
        )
        params["months"] = months
        params["month_names"] = r"\m(" + "|".join(names) + r")\M"
    if kind:
        clauses.append("i.kind = :kind")
        params["kind"] = kind
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


def search(db: Session, q: str, category: str | None = None, limit: int = 20,
           kind: str | None = None) -> tuple[ParsedQuery, list[Hit]]:
    parsed = parse_query(q)
    hits = _search(db, parsed, parsed.years, category, limit, kind, parsed.months)
    if not hits and parsed.months:
        hits = _search(db, parsed, parsed.years, category, limit, kind)
    if not hits and parsed.years and parsed.text:
        # Si nada tiene ese año, mejor mostrar lo más parecido que nada.
        hits = _search(db, parsed, [], category, limit, kind)
    _snippets(db, hits, parsed.text)
    return parsed, hits


def _search(db: Session, parsed: ParsedQuery, years: list[int], category: str | None, limit: int,
            kind: str | None = None, months: list[int] | None = None) -> list[Hit]:
    where, params = _filters(years, category, kind, months)

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

    _boost_titles(db, hits, parsed.text)
    return sorted(hits.values(), key=lambda h: h.score, reverse=True)[:limit]


def _fold(value: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", value.lower()) if unicodedata.category(c) != "Mn")


TITLE_BOOST = 0.04  # más que la diferencia entre el 1.º y el 10.º puesto de una lista


def _boost_titles(db: Session, hits: dict[uuid.UUID, "Hit"], query_text: str) -> None:
    """Si lo que buscas está en el título o el tipo («factura»), ese documento va primero:
    es lo que es, no algo que lo menciona."""
    words = [w[:6] for w in re.findall(r"\w{3,}", _fold(query_text))]
    if not words or not hits:
        return
    rows = db.execute(
        text("SELECT id, title, coalesce(doc_type, '') AS doc_type FROM items WHERE id = ANY(:ids)"),
        {"ids": list(hits)},
    )
    for row in rows:
        label = _fold(f"{row.title} {row.doc_type}")
        found = sum(1 for w in words if w in label)
        hits[row.id].score += TITLE_BOOST * found / len(words)
