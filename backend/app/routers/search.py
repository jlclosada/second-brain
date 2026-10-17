import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import require_user
from app.db import get_db
from app.models import Item
from app.schemas import AskRequest, AskResponse, AskSource, ItemOut, SearchHit, SearchResponse
from app.services.ask import AskUnavailable, ask
from app.services.search import search

router = APIRouter(prefix="/api", tags=["search"], dependencies=[Depends(require_user)])


@router.get("/search", response_model=SearchResponse)
def search_endpoint(q: str, category: str | None = None, limit: int = 20, db: Session = Depends(get_db)):
    parsed, hits = search(db, q, category=category, limit=min(limit, 50))
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


@router.post("/ask", response_model=AskResponse)
def ask_endpoint(body: AskRequest, db: Session = Depends(get_db)):
    if not body.question.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Escribe una pregunta")
    try:
        answer, sources = ask(db, body.question)
    except AskUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
    except anthropic.APIError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Error al consultar a Claude: {exc}") from None
    return AskResponse(answer=answer, sources=[AskSource(**s.__dict__) for s in sources])
