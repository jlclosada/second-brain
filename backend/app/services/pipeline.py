"""Ingesta de documentos: extraer texto → clasificar → trocear → embeddings."""

import logging
import uuid
from datetime import date
from pathlib import Path

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Item
from app.services.classify import classify
from app.services.extract import extract_text
from app.services.indexing import reindex
from app.services.jobs import enqueue, handler, on_failure

log = logging.getLogger(__name__)


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def schedule_processing(db: Session, item: Item) -> None:
    item.status = "pending"
    item.error = None
    enqueue(db, "process_document", {"item_id": str(item.id)}, dedupe=True)


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


@handler("process_document")
def _process_document(db: Session, payload: dict) -> None:
    item = db.get(Item, uuid.UUID(payload["item_id"]))
    if item is None:
        return
    item.status = "processing"
    db.commit()
    process_item(db, item)
    log.info("Procesado: %s → %s / %s", item.id, item.category, item.title)


@on_failure("process_document")
def _process_failed(db: Session, payload: dict, exc: Exception) -> None:
    db.execute(
        update(Item).where(Item.id == uuid.UUID(payload["item_id"])).values(status="error", error=str(exc)[:2000])
    )
