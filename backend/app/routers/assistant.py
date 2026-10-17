import uuid

import anthropic
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Conversation
from app.schemas import ChatIn, ChatMessage, ChatOut, ConversationDetail, ConversationOut
from app.security import require_user
from app.services.assistant import AssistantUnavailable, chat

router = APIRouter(prefix="/api/assistant", tags=["assistant"], dependencies=[Depends(require_user)])


@router.post("/chat", response_model=ChatOut)
def send(body: ChatIn, db: Session = Depends(get_db)):
    try:
        conv, reply = chat(db, body.message, body.conversation_id)
    except AssistantUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from None
    except anthropic.RateLimitError:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Claude está saturado; prueba en un minuto.") from None
    except anthropic.APIStatusError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Claude respondió con un error ({exc.status_code}).") from None
    except anthropic.APIConnectionError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No hay conexión con Claude.") from None
    return ChatOut(conversation_id=conv.id, reply=reply)


@router.get("/conversations", response_model=list[ConversationOut])
def conversations(db: Session = Depends(get_db)):
    rows = db.scalars(select(Conversation).order_by(Conversation.updated_at.desc()).limit(50))
    return [ConversationOut(id=c.id, title=c.title, updated_at=c.updated_at) for c in rows]


@router.get("/conversations/{conv_id}", response_model=ConversationDetail)
def conversation(conv_id: uuid.UUID, db: Session = Depends(get_db)):
    c = db.get(Conversation, conv_id)
    if c is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return ConversationDetail(id=c.id, title=c.title, updated_at=c.updated_at,
                              messages=[ChatMessage.model_validate(m) for m in c.messages])


@router.delete("/conversations/{conv_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conv_id: uuid.UUID, db: Session = Depends(get_db)):
    c = db.get(Conversation, conv_id)
    if c is not None:
        db.delete(c)
        db.commit()
