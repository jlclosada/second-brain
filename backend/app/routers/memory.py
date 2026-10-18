"""La memoria de Jarvis: el vault de Obsidian, Descargas y lo que ha hecho solo."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Item, Notification, VaultNote
from app.security import require_user
from app.services import downloads, vault
from app.services.jobs import enqueue

router = APIRouter(prefix="/api", tags=["memory"], dependencies=[Depends(require_user)])


class CaptureNote(BaseModel):
    text: str = Field(min_length=1, max_length=20000)
    title: str | None = Field(default=None, max_length=200)


@router.get("/memory/status")
def memory_status(db: Session = Depends(get_db)):
    r = vault.root()
    notes = db.scalar(select(func.count()).select_from(VaultNote)) or 0
    filed = db.scalar(select(func.count()).select_from(Item).where(Item.entities["filed_to"].astext.is_not(None))) or 0
    processing = db.scalar(
        select(func.count()).select_from(Item).where(Item.kind == "document", Item.status.in_(("pending", "processing")))
    ) or 0
    return {
        "vault": {"configured": r is not None, "name": vault.vault_name(), "notes": notes},
        "downloads": {**downloads.status(), "filed": filed, "processing": processing},
        "ai_enabled": bool(get_settings().anthropic_api_key),
    }


@router.get("/memory/tree")
def memory_tree(db: Session = Depends(get_db)):
    return vault.tree(db)


@router.get("/memory/note")
def memory_note(path: str | None = Query(None, max_length=500), id: uuid.UUID | None = None,
                db: Session = Depends(get_db)):
    """Una nota por su ruta, por su título (como en un [[wikilink]]) o por su id."""
    note = None
    if id is not None:
        note = db.get(VaultNote, id)
    elif path:
        note = db.scalars(select(VaultNote).where(VaultNote.path == path)).first() or vault.find_note(db, path)
    if note is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Esa nota no está en el vault")
    title = note.item.title
    backlinks = db.execute(
        select(VaultNote.path, Item.title).join(Item, Item.id == VaultNote.item_id)
        .where(VaultNote.body.ilike(f"%[[{title.replace('%', '')}%"), VaultNote.path != note.path)
        .order_by(Item.title).limit(50)
    ).all()
    return {
        "id": str(note.item_id), "path": note.path, "title": title, "folder": note.folder,
        "frontmatter": note.frontmatter, "body": note.body, "obsidian_url": vault.obsidian_url(note.path),
        "updated_at": note.item.updated_at, "backlinks": [{"path": p, "title": t} for p, t in backlinks],
    }


@router.post("/memory/capture", status_code=status.HTTP_201_CREATED)
def memory_capture(body: CaptureNote, db: Session = Depends(get_db)):
    try:
        title = body.title or body.text.strip().splitlines()[0][:80]
        path = vault.capture(db, title, body.text)
    except vault.VaultError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None
    return {"path": path, "obsidian_url": vault.obsidian_url(path)}


@router.post("/memory/sync", status_code=status.HTTP_202_ACCEPTED)
def memory_sync(db: Session = Depends(get_db)):
    enqueue(db, "sync_vault", {}, dedupe=True, max_attempts=1)
    enqueue(db, "scan_downloads", {}, dedupe=True, max_attempts=1)
    db.commit()
    return {"queued": True}


@router.get("/activity")
def activity_feed(limit: int = Query(30, le=100), db: Session = Depends(get_db)):
    """Lo que Jarvis ha hecho por su cuenta, lo más reciente primero."""
    rows = db.scalars(
        select(Notification).where(Notification.kind == "jarvis").order_by(Notification.created_at.desc()).limit(limit)
    ).all()
    return [{"id": str(n.id), "title": n.title, "body": n.body, "url": n.url, "at": n.created_at} for n in rows]
