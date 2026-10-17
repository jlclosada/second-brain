"""Cadena de ingesta: extraer texto → clasificar → trocear → embeddings."""

import logging
from datetime import date
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Chunk, Item
from app.services.chunking import split_text
from app.services.classify import classify
from app.services.embeddings import embed
from app.services.extract import extract_text

log = logging.getLogger(__name__)


def card_text(item: Item) -> str:
    """Ficha del documento: lo que más se busca, en un solo fragmento."""
    parts = [
        item.title,
        f"Tipo: {item.doc_type}" if item.doc_type else "",
        f"Categoría: {item.category}" if item.category else "",
        f"Año: {item.year}" if item.year else "",
        f"Vence: {item.expires_on.isoformat()}" if item.expires_on else "",
        f"Etiquetas: {', '.join(item.tags)}" if item.tags else "",
        " · ".join(e.get("name", "") for e in item.entities.get("list", [])) if item.entities else "",
        item.summary or "",
    ]
    return "\n".join(p for p in parts if p)


def reindex(session: Session, item: Item) -> None:
    """Regenera fragmentos y embeddings a partir de la ficha y del texto."""
    texts = [card_text(item)]
    if item.document and item.document.text:
        texts += split_text(item.document.text)
    vectors = embed(texts)
    item.chunks.clear()
    session.flush()
    for i, (content, vector) in enumerate(zip(texts, vectors)):
        item.chunks.append(Chunk(ord=i, content=content, embedding=vector))


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def process_item(session: Session, item: Item) -> None:
    doc = item.document
    if doc is None:
        raise ValueError("El elemento no tiene documento asociado")

    extracted = extract_text(Path(doc.path), doc.mime)
    doc.text = extracted.text
    doc.pages = extracted.pages
    doc.ocr_used = extracted.ocr_used

    info = classify(extracted.text, doc.filename)
    item.title = info.title[:300]
    item.doc_type = info.doc_type[:80]
    item.category = info.category
    item.summary = info.summary
    item.doc_date = _parse_date(info.doc_date)
    item.expires_on = _parse_date(info.expires_on)
    item.year = info.year or (item.doc_date.year if item.doc_date else None)
    item.tags = sorted({t.strip().lower() for t in info.tags if t.strip()})
    item.entities = {"list": [e.model_dump() for e in info.entities]}

    reindex(session, item)
    item.status = "ready"
    item.error = None


def claim_next(session: Session) -> Item | None:
    """Toma el siguiente documento pendiente. SKIP LOCKED permite varios workers."""
    item = session.scalars(
        select(Item)
        .where(Item.status == "pending")
        .order_by(Item.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).first()
    if item:
        item.status = "processing"
        session.commit()
    return item


def run_once(session: Session) -> bool:
    """Procesa un documento pendiente. Devuelve False si no había ninguno."""
    item = claim_next(session)
    if item is None:
        return False
    try:
        process_item(session, item)
        session.commit()
        log.info("Procesado: %s → %s / %s", item.id, item.category, item.title)
    except Exception as exc:
        session.rollback()
        log.exception("Error procesando %s", item.id)
        session.execute(
            update(Item).where(Item.id == item.id).values(status="error", error=str(exc)[:2000])
        )
        session.commit()
    return True


def reset_stuck(session: Session) -> None:
    """Al arrancar, lo que quedó a medias vuelve a la cola."""
    session.execute(update(Item).where(Item.status == "processing").values(status="pending"))
    session.commit()
