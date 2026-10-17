"""Preguntas en lenguaje natural respondidas con tus documentos como fuente."""

from dataclasses import dataclass

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Chunk, Item
from app.services.search import search

MAX_SOURCES = 6
CHUNKS_PER_SOURCE = 3

SYSTEM_PROMPT = """Eres el asistente del "segundo cerebro" de una persona. Respondes en español,
de forma breve y directa, usando SOLO los documentos que se te dan entre <fuentes>.
Cita cada dato con el número de su fuente entre corchetes, por ejemplo [2].
Si las fuentes no contienen la respuesta, dilo claramente y sugiere qué documento falta.
No inventes fechas, importes ni nombres."""


class AskUnavailable(RuntimeError):
    pass


@dataclass
class Source:
    n: int
    item_id: str
    title: str
    category: str | None
    year: int | None


def ask(db: Session, question: str) -> tuple[str, list[Source]]:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise AskUnavailable("Configura ANTHROPIC_API_KEY para hacer preguntas en lenguaje natural.")

    _, hits = search(db, question, limit=MAX_SOURCES)
    if not hits:
        return "No he encontrado ningún documento relacionado con tu pregunta.", []

    sources: list[Source] = []
    blocks: list[str] = []
    for n, hit in enumerate(hits, start=1):
        item = db.get(Item, hit.item_id)
        chunk_ids = {hit.chunk_id}
        card = db.scalar(select(Chunk).where(Chunk.item_id == item.id, Chunk.ord == 0))
        if card:
            chunk_ids.add(card.id)
        extra = db.scalars(
            select(Chunk).where(Chunk.item_id == item.id, Chunk.id.not_in(chunk_ids)).order_by(Chunk.ord).limit(
                max(0, CHUNKS_PER_SOURCE - len(chunk_ids))
            )
        ).all()
        chunks = db.scalars(select(Chunk).where(Chunk.id.in_(chunk_ids)).order_by(Chunk.ord)).all() + list(extra)
        body = "\n…\n".join(c.content for c in sorted(chunks, key=lambda c: c.ord))
        blocks.append(f'<fuente n="{n}" titulo="{item.title}">\n{body}\n</fuente>')
        sources.append(Source(n=n, item_id=str(item.id), title=item.title, category=item.category, year=item.year))

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    response = client.messages.create(
        model=settings.chat_model,
        max_tokens=2048,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": "<fuentes>\n" + "\n\n".join(blocks) + f"\n</fuentes>\n\nPregunta: {question}",
        }],
    )
    if response.stop_reason == "refusal":
        return "No puedo responder a esta pregunta.", sources
    answer = "".join(block.text for block in response.content if block.type == "text").strip()
    return answer, sources
