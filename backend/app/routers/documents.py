import mimetypes
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.config import Settings, get_settings
from app.db import get_db
from app.models import CATEGORIES, Document, Item
from app.schemas import FacetCount, ItemDetail, ItemList, ItemOut, ItemUpdate, Stats, UploadResult
from app.security import require_user
from app.services import storage
from app.services.indexing import schedule_index
from app.services.pipeline import schedule_processing

ACTIVE_CONTENT = ("html", "svg", "xml", "javascript")

router = APIRouter(prefix="/api", tags=["documents"], dependencies=[Depends(require_user)])


def _get_item(db: Session, item_id: uuid.UUID) -> Item:
    item = db.get(Item, item_id, options=[selectinload(Item.document)])
    if item is None or item.kind != "document":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Documento no encontrado")
    return item


@router.post("/documents", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
async def upload(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    created, duplicates = [], []
    for upload_file in files:
        data = await upload_file.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"{upload_file.filename} supera {settings.max_upload_mb} MB")
        digest = storage.sha256(data)
        if db.scalar(select(Document.item_id).where(Document.sha256 == digest)):
            duplicates.append(upload_file.filename or "")
            continue

        filename = storage.safe_name(upload_file.filename or "documento")
        mime = upload_file.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        item = Item(id=uuid.uuid4(), kind="document", title=filename, status="pending", tags=[], entities={})
        path = storage.save_original(item.id, filename, data)
        item.document = Document(filename=filename, mime=mime, size=len(data), sha256=digest, path=str(path))
        db.add(item)
        db.flush()
        schedule_processing(db, item)
        db.commit()
        created.append(item)
    return UploadResult(created=[ItemOut.model_validate(i) for i in created], duplicates=duplicates)


@router.get("/documents", response_model=ItemList)
def list_documents(
    category: str | None = None,
    year: int | None = None,
    status_: str | None = Query(default=None, alias="status"),
    tag: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = select(Item).where(Item.kind == "document")
    if category:
        query = query.where(Item.category == category)
    if year:
        query = query.where(Item.year == year)
    if status_:
        query = query.where(Item.status == status_)
    if tag:
        query = query.where(Item.tags.any(tag))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    items = db.scalars(
        query.options(selectinload(Item.document))
        .order_by(Item.doc_date.desc().nulls_last(), Item.created_at.desc())
        .limit(min(limit, 200))
        .offset(offset)
    ).all()
    return ItemList(items=[ItemOut.model_validate(i) for i in items], total=total or 0)


@router.get("/documents/{item_id}", response_model=ItemDetail)
def get_document(item_id: uuid.UUID, db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    detail = ItemDetail.model_validate(item)
    detail.text = item.document.text if item.document else None
    return detail


@router.patch("/documents/{item_id}", response_model=ItemOut)
def update_document(item_id: uuid.UUID, body: ItemUpdate, db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    changes = body.model_dump(exclude_unset=True)
    if "category" in changes and changes["category"] not in CATEGORIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Categoría no válida: {changes['category']}")
    if "tags" in changes:
        changes["tags"] = sorted({t.strip().lower() for t in changes["tags"] or [] if t.strip()})
    for key, value in changes.items():
        setattr(item, key, value)
    if item.status == "ready":
        schedule_index(db, item.id)  # la ficha cambia, así que también su fragmento de búsqueda
    db.commit()
    return ItemOut.model_validate(item)


@router.post("/documents/{item_id}/reprocess", response_model=ItemOut)
def reprocess(item_id: uuid.UUID, db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    schedule_processing(db, item)
    db.commit()
    return ItemOut.model_validate(item)


@router.delete("/documents/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(item_id: uuid.UUID, db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    path = item.document.path if item.document else None
    db.delete(item)
    db.commit()
    if path:
        storage.delete_original(path)


@router.get("/documents/{item_id}/file")
def download(item_id: uuid.UUID, download: bool = False, db: Session = Depends(get_db)):
    item = _get_item(db, item_id)
    if not item.document:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sin archivo")
    mime = item.document.mime
    headers = {"X-Content-Type-Options": "nosniff"}
    if any(kind in mime for kind in ACTIVE_CONTENT):
        # Un HTML o SVG subido podría ejecutar código con tu sesión: se aísla.
        headers["Content-Security-Policy"] = "sandbox"
    return FileResponse(
        item.document.path,
        media_type=mime,
        filename=item.document.filename,
        content_disposition_type="attachment" if download else "inline",
        headers=headers,
    )


@router.get("/categories")
def categories():
    return CATEGORIES


@router.get("/stats", response_model=Stats)
def stats(db: Session = Depends(get_db)):
    def facet(column):
        rows = db.execute(
            select(column, func.count()).where(Item.status == "ready", column.is_not(None)).group_by(column).order_by(func.count().desc())
        )
        return [FacetCount(value=str(v), count=c) for v, c in rows]

    today = date.today()
    expiring = db.scalars(
        select(Item)
        .options(selectinload(Item.document))
        .where(Item.expires_on.between(today, today + timedelta(days=60)))
        .order_by(Item.expires_on)
        .limit(10)
    ).all()
    count = lambda *where: db.scalar(select(func.count()).select_from(Item).where(*where)) or 0  # noqa: E731
    return Stats(
        total=count(Item.kind == "document"),
        pending=count(Item.status.in_(["pending", "processing"])),
        errors=count(Item.status == "error"),
        categories=facet(Item.category),
        years=sorted(facet(Item.year), key=lambda f: f.value, reverse=True),
        expiring=[ItemOut.model_validate(i) for i in expiring],
    )
