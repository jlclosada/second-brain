import uuid
from datetime import date

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Item, Note
from app.schemas import NoteDetail, NoteIn, NoteOut, NoteUpdate
from app.security import require_user
from app.services import brain

router = APIRouter(prefix="/api", tags=["notes"], dependencies=[Depends(require_user)])


def _detail(db: Session, item: Item) -> NoteDetail:
    links, backlinks = brain.links_of(db, item)
    return NoteDetail(**brain.note_out(item).model_dump(), links=links, backlinks=backlinks)


@router.get("/notes", response_model=list[NoteOut])
def list_notes(tag: str | None = None, project_id: uuid.UUID | None = None, journal: bool = False,
               limit: int = 200, db: Session = Depends(get_db)):
    query = (
        select(Item).join(Note).options(selectinload(Item.note)).where(Item.kind == "note")
        .where(Note.journal_date.is_not(None) if journal else Note.journal_date.is_(None))
    )
    if tag:
        query = query.where(Item.tags.any(tag.lower()))
    if project_id:
        query = query.where(Item.project_id == project_id)
    order = (Note.journal_date.desc(),) if journal else (Item.pinned.desc(), Item.updated_at.desc())
    return [brain.note_out(i) for i in db.scalars(query.order_by(*order).limit(min(limit, 500)))]


@router.post("/notes", response_model=NoteDetail, status_code=status.HTTP_201_CREATED)
def create_note(body: NoteIn, db: Session = Depends(get_db)):
    return _detail(db, brain.create_note(db, body))


@router.get("/notes/{item_id}", response_model=NoteDetail)
def get_note(item_id: uuid.UUID, db: Session = Depends(get_db)):
    return _detail(db, brain.get_item(db, item_id, "note"))


@router.patch("/notes/{item_id}", response_model=NoteDetail)
def update_note(item_id: uuid.UUID, body: NoteUpdate, db: Session = Depends(get_db)):
    item = brain.get_item(db, item_id, "note")
    return _detail(db, brain.update_note(db, item, body.model_dump(exclude_unset=True)))


@router.delete("/notes/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(item_id: uuid.UUID, db: Session = Depends(get_db)):
    db.delete(brain.get_item(db, item_id, "note"))
    db.commit()


@router.get("/journal/{day}", response_model=NoteDetail)
def journal(day: date, db: Session = Depends(get_db)):
    """Entrada del diario de ese día; se crea vacía si no existía."""
    return _detail(db, brain.journal_for(db, day, create=True))


@router.get("/titles", response_model=list[dict])
def titles(q: str = "", db: Session = Depends(get_db)):
    """Para autocompletar enlaces [[…]] en las notas."""
    query = select(Item.id, Item.kind, Item.title).where(Item.status == "ready")
    if q:
        query = query.where(Item.title.ilike(f"%{q.replace('%', '').replace('_', '')}%"))
    rows = db.execute(query.order_by(Item.updated_at.desc()).limit(12))
    return [{"id": str(r.id), "kind": r.kind, "title": r.title} for r in rows]
