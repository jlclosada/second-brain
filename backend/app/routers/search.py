from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Item
from app.schemas import ItemOut, SearchHit, SearchResponse
from app.security import require_user
from app.services.search import search

router = APIRouter(prefix="/api", tags=["search"], dependencies=[Depends(require_user)])


@router.get("/search", response_model=SearchResponse)
def search_endpoint(
    q: str,
    category: str | None = None,
    kind: Literal["document", "note", "task", "event"] | None = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    parsed, hits = search(db, q[:300], category=category, limit=min(limit, 50), kind=kind)
    items = {
        i.id: i
        for i in db.scalars(
            select(Item).options(selectinload(Item.document)).where(Item.id.in_([h.item_id for h in hits]))
        )
    }
    return SearchResponse(
        query=q,
        text=parsed.text,
        years=parsed.years,
        hits=[
            SearchHit(
                item=ItemOut.model_validate(items[h.item_id]),
                score=h.score,
                snippet=h.snippet,
                matched_by=[name for name, rank in (("palabras", h.keyword_rank), ("significado", h.semantic_rank)) if rank],
            )
            for h in hits
            if h.item_id in items
        ],
    )
