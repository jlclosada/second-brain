"""Indexado para la búsqueda: cada elemento se trocea y se guarda con su
vector de significado. El fragmento 0 es siempre la "ficha" del elemento."""

import uuid

from sqlalchemy.orm import Session

from app.models import Chunk, Item
from app.services.chunking import split_text
from app.services.embeddings import embed
from app.services.jobs import enqueue, handler

KIND_LABEL = {"document": "Documento", "note": "Nota", "task": "Tarea", "event": "Evento"}


def card_text(item: Item) -> str:
    """Lo que más se busca de un elemento, en un solo fragmento."""
    parts = [item.title, KIND_LABEL.get(item.kind, "")]
    if item.kind == "document":
        parts += [
            f"Tipo: {item.doc_type}" if item.doc_type else "",
            f"Categoría: {item.category}" if item.category else "",
            f"Año: {item.year}" if item.year else "",
            f"Vence: {item.expires_on.isoformat()}" if item.expires_on else "",
        ]
    elif item.kind == "task" and item.task:
        t = item.task
        parts += [
            f"Para el {t.due_date.isoformat()}" if t.due_date else "",
            "Hecha" if t.done_at else "Pendiente",
            t.notes[:500],
        ]
    elif item.kind == "event" and item.event:
        e = item.event
        parts += [
            f"Fecha: {e.starts_at.date().isoformat()}",
            f"Lugar: {e.location}" if e.location else "",
            (e.description or "")[:500],
        ]
    if item.project:
        parts.append(f"Proyecto: {item.project.name}")
    if item.tags:
        parts.append(f"Etiquetas: {', '.join(item.tags)}")
    if item.entities:
        parts.append(" · ".join(e.get("name", "") for e in item.entities.get("list", [])))
    if item.summary:
        parts.append(item.summary)
    return "\n".join(p for p in parts if p)


def body_text(item: Item) -> str | None:
    if item.kind == "document" and item.document:
        return item.document.text
    if item.kind == "note" and item.note:
        return item.note.body
    return None


def reindex(session: Session, item: Item) -> None:
    """Regenera fragmentos y embeddings a partir de la ficha y del texto."""
    texts = [card_text(item)]
    body = body_text(item)
    if body:
        texts += split_text(body)
    vectors = embed(texts)
    item.chunks.clear()
    session.flush()
    for i, (content, vector) in enumerate(zip(texts, vectors, strict=True)):
        item.chunks.append(Chunk(ord=i, content=content, embedding=vector))


def schedule_index(db: Session, item_id: uuid.UUID) -> None:
    """Pide al worker que reindexe. Así guardar una nota es instantáneo."""
    enqueue(db, "index_item", {"item_id": str(item_id)}, dedupe=True)


@handler("index_item")
def _index_item(db: Session, payload: dict) -> None:
    item = db.get(Item, uuid.UUID(payload["item_id"]))
    if item is not None:
        reindex(db, item)
