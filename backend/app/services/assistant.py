"""Asistente: conversa con Claude, que consulta y modifica tu segundo cerebro
mediante herramientas (buscar, ver la agenda, crear tareas, eventos y notas…)."""

import json
import logging
import uuid
from datetime import date, datetime, time
from typing import Any

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Chunk, Conversation, Item, Task
from app.schemas import ChatAction, ChatMessage, EventIn, NoteIn, ReminderIn, TaskIn
from app.services import brain
from app.services.calendar import events_between, local_day_bounds
from app.services.search import search

log = logging.getLogger(__name__)

MAX_STEPS = 10
# Modelos que admiten el reintento automático con otro modelo si uno rechaza la petición.
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

SYSTEM_PROMPT = """Eres el asistente del "segundo cerebro" de una persona: su archivo de documentos,
notas, tareas, calendario y recordatorios. Respondes en español, breve y directo.

- Para responder sobre su vida, documentos o agenda, consulta primero con las herramientas; no supongas.
- Cuando uses información de un elemento, nómbralo por su título para que pueda abrirlo.
- Puedes crear tareas, eventos, notas y recordatorios, y completar tareas, cuando te lo pida o
  cuando sea claramente lo que quiere. Di qué has hecho en una frase.
- Las fechas relativas ("el martes", "mañana") se calculan desde el momento indicado en cada mensaje.
- Si no encuentras algo, dilo y sugiere qué podría faltar. No inventes fechas, importes ni nombres."""


class AssistantUnavailable(RuntimeError):
    pass


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


_S = {"type": "string"}
_NS = {"type": ["string", "null"]}

TOOLS = [
    _tool("buscar", "Busca en todo el segundo cerebro (documentos, notas, tareas y eventos) por palabras y significado. "
          "Devuelve los elementos más relevantes con un fragmento.",
          {"consulta": _S, "tipo": {"type": ["string", "null"], "enum": ["document", "note", "task", "event", None]}},
          ["consulta", "tipo"]),
    _tool("ver_elemento", "Lee el contenido completo de un elemento por su id (texto del documento, cuerpo de la nota…).",
          {"id": _S}, ["id"]),
    _tool("agenda", "Eventos y tareas con fecha entre dos días (ambos incluidos). Fechas AAAA-MM-DD.",
          {"desde": _S, "hasta": _S}, ["desde", "hasta"]),
    _tool("tareas_pendientes", "Lista las tareas sin completar: vencidas, para hoy y próximas.", {}, []),
    _tool("crear_tarea", "Crea una tarea. Fecha AAAA-MM-DD y hora HH:MM opcionales. Prioridad 0-3.",
          {"titulo": _S, "fecha": _NS, "hora": _NS, "prioridad": {"type": "integer"}, "notas": _NS},
          ["titulo", "fecha", "hora", "prioridad", "notas"]),
    _tool("completar_tarea", "Marca una tarea como hecha por su id.", {"id": _S}, ["id"]),
    _tool("crear_evento", "Crea un evento en el calendario. inicio y fin en AAAA-MM-DDTHH:MM (hora local) o "
          "AAAA-MM-DD si es de día completo.",
          {"titulo": _S, "inicio": _S, "fin": _NS, "dia_completo": {"type": "boolean"}, "lugar": _NS,
           "aviso_minutos": {"type": ["integer", "null"]}},
          ["titulo", "inicio", "fin", "dia_completo", "lugar", "aviso_minutos"]),
    _tool("crear_nota", "Guarda una nota en markdown.", {"titulo": _S, "contenido": _S}, ["titulo", "contenido"]),
    _tool("crear_recordatorio", "Programa un aviso push a una hora concreta (AAAA-MM-DDTHH:MM, hora local).",
          {"texto": _S, "cuando": _S}, ["texto", "cuando"]),
    _tool("escribir_en_diario", "Añade un párrafo a la entrada del diario de hoy.", {"texto": _S}, ["texto"]),
]

_LINKS = {"document": "/documentos/{id}", "note": "/notas/{id}", "task": "/tareas?t={id}", "event": "/calendario?evento={id}"}


def _link(item: Item) -> str:
    return _LINKS.get(item.kind, "/").format(id=item.id)


def _local(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=get_settings().tz)


def _fmt_dt(dt: datetime) -> str:
    return dt.astimezone(get_settings().tz).strftime("%Y-%m-%d %H:%M")


class Toolbox:
    def __init__(self, db: Session):
        self.db = db
        self.actions: list[ChatAction] = []

    def run(self, name: str, args: dict) -> Any:
        fn = getattr(self, f"t_{name}", None)
        if fn is None:
            raise ValueError(f"Herramienta desconocida: {name}")
        return fn(**args)

    def t_buscar(self, consulta: str, tipo: str | None) -> list[dict]:
        _, hits = search(self.db, consulta, kind=tipo, limit=8)
        out = []
        for h in hits:
            item = self.db.get(Item, h.item_id)
            out.append({"id": str(item.id), "tipo": item.kind, "titulo": item.title,
                        "fragmento": h.snippet.replace("<mark>", "").replace("</mark>", ""),
                        "categoria": item.category, "año": item.year})
        self.actions.append(ChatAction(tool="buscar", summary=f"Buscó «{consulta}»: {len(out)} resultados"))
        return out

    def t_ver_elemento(self, id: str) -> dict:
        item = brain.get_item(self.db, uuid.UUID(id))
        data: dict[str, Any] = {"id": str(item.id), "tipo": item.kind, "titulo": item.title, "etiquetas": item.tags}
        if item.kind == "document":
            text = item.document.text if item.document else ""
            if not text:
                text = "\n".join(c.content for c in self.db.scalars(
                    select(Chunk).where(Chunk.item_id == item.id).order_by(Chunk.ord)))
            data |= {"resumen": item.summary, "categoria": item.category, "vence": str(item.expires_on or ""),
                     "texto": text[:12000]}
        elif item.kind == "note":
            data["contenido"] = item.note.body[:12000]
        elif item.kind == "task":
            data |= brain.task_out(item).model_dump(mode="json")
        elif item.kind == "event":
            data |= brain.event_item_out(item).model_dump(mode="json")
        self.actions.append(ChatAction(tool="ver_elemento", summary=f"Leyó «{item.title}»", link=_link(item)))
        return data

    def t_agenda(self, desde: str, hasta: str) -> dict:
        first, last = date.fromisoformat(desde), date.fromisoformat(hasta)
        start, _ = local_day_bounds(first)
        _, end = local_day_bounds(last)
        events = [{"id": str(o.item.id), "titulo": o.item.title, "inicio": _fmt_dt(o.starts_at),
                   "fin": _fmt_dt(o.ends_at), "dia_completo": o.event.all_day, "lugar": o.event.location}
                  for o in events_between(self.db, start, end)]
        tasks = [{"id": str(i.id), "titulo": i.title, "fecha": str(t.due_date), "hora": str(t.due_time or ""),
                  "hecha": bool(t.done_at)}
                 for t, i in self.db.execute(select(Task, Item).join(Item, Item.id == Task.item_id)
                                             .where(Task.due_date.between(first, last)).order_by(Task.due_date))]
        self.actions.append(ChatAction(tool="agenda", summary=f"Consultó la agenda del {desde} al {hasta}"))
        return {"eventos": events, "tareas": tasks}

    def t_tareas_pendientes(self) -> list[dict]:
        rows = self.db.execute(
            select(Task, Item).join(Item, Item.id == Task.item_id).where(Task.done_at.is_(None))
            .order_by(Task.due_date.asc().nulls_last(), Task.priority.desc()).limit(60)
        ).all()
        self.actions.append(ChatAction(tool="tareas_pendientes", summary="Revisó las tareas pendientes"))
        return [{"id": str(i.id), "titulo": i.title, "fecha": str(t.due_date or ""), "prioridad": t.priority}
                for t, i in rows]

    def t_crear_tarea(self, titulo: str, fecha: str | None, hora: str | None, prioridad: int, notas: str | None):
        item = brain.create_task(self.db, TaskIn(
            title=titulo, due_date=date.fromisoformat(fecha) if fecha else None,
            due_time=time.fromisoformat(hora) if hora and fecha else None,
            priority=max(0, min(3, prioridad)), notes=notas or "",
        ))
        self.actions.append(ChatAction(tool="crear_tarea", summary=f"Creó la tarea «{item.title}»", link=_link(item)))
        return {"id": str(item.id), "ok": True}

    def t_completar_tarea(self, id: str):
        item = brain.get_item(self.db, uuid.UUID(id), "task")
        brain.update_task(self.db, item, {"done": True})
        self.actions.append(ChatAction(tool="completar_tarea", summary=f"Completó «{item.title}»", link=_link(item)))
        return {"ok": True, "siguiente_fecha": str(item.task.due_date) if item.task.done_at is None else None}

    def t_crear_evento(self, titulo: str, inicio: str, fin: str | None, dia_completo: bool, lugar: str | None,
                       aviso_minutos: int | None):
        item = brain.create_event(self.db, EventIn(
            title=titulo, starts_at=_local(inicio), ends_at=_local(fin) if fin else None, all_day=dia_completo,
            location=lugar, remind_minutes=aviso_minutos,
        ))
        when = _fmt_dt(item.event.starts_at)
        self.actions.append(ChatAction(tool="crear_evento", summary=f"Añadió «{item.title}» el {when}", link=_link(item)))
        return {"id": str(item.id), "inicio": when, "ok": True}

    def t_crear_nota(self, titulo: str, contenido: str):
        item = brain.create_note(self.db, NoteIn(title=titulo, body=contenido))
        self.actions.append(ChatAction(tool="crear_nota", summary=f"Guardó la nota «{item.title}»", link=_link(item)))
        return {"id": str(item.id), "ok": True}

    def t_crear_recordatorio(self, texto: str, cuando: str):
        r = brain.create_reminder(self.db, ReminderIn(title=texto, remind_at=_local(cuando)))
        self.actions.append(ChatAction(tool="crear_recordatorio",
                                       summary=f"Te avisará el {_fmt_dt(r.remind_at)}: {r.title}", link="/hoy"))
        return {"id": str(r.id), "ok": True}

    def t_escribir_en_diario(self, texto: str):
        today = datetime.now(get_settings().tz).date()
        item = brain.journal_for(self.db, today, create=True)
        body = (item.note.body.rstrip() + "\n\n" + texto.strip()).strip()
        brain.update_note(self.db, item, {"body": body})
        self.actions.append(ChatAction(tool="escribir_en_diario", summary="Escribió en el diario de hoy",
                                       link=f"/diario/{today.isoformat()}"))
        return {"ok": True}


def _client() -> anthropic.Anthropic:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise AssistantUnavailable("Añade ANTHROPIC_API_KEY en .env para usar el asistente.")
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def _create(client: anthropic.Anthropic, messages: list[dict]):
    model = get_settings().chat_model
    params = dict(
        model=model,
        max_tokens=16000,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        tools=TOOLS,
        messages=messages,
        output_config={"effort": "medium"},
    )
    if model in FALLBACK_MODELS:
        return client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
    return client.messages.create(**params)


def chat(db: Session, text: str, conversation_id: uuid.UUID | None) -> tuple[Conversation, ChatMessage]:
    client = _client()
    conv = db.get(Conversation, conversation_id) if conversation_id else None
    if conv is None:
        conv = Conversation(title=text.strip()[:80], messages=[], api_messages=[])
        db.add(conv)
        db.commit()

    now = datetime.now(get_settings().tz)
    weekday = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][now.weekday()]
    api = list(conv.api_messages)
    api.append({"role": "user", "content": f"[Ahora: {weekday} {now.strftime('%Y-%m-%d %H:%M')}]\n{text}"})

    tools = Toolbox(db)
    reply_text = ""
    for _ in range(MAX_STEPS):
        response = _create(client, api)
        api.append({"role": "assistant", "content": [b.to_dict() for b in response.content]})
        if response.stop_reason == "refusal":
            reply_text = "No puedo ayudarte con esto."
            break
        if response.stop_reason == "max_tokens":
            reply_text = "".join(b.text for b in response.content if b.type == "text") + "…"
            break
        calls = [b for b in response.content if b.type == "tool_use"]
        if response.stop_reason != "tool_use" or not calls:
            reply_text = "".join(b.text for b in response.content if b.type == "text").strip()
            break
        results = []
        for call in calls:
            try:
                output = tools.run(call.name, dict(call.input))
                results.append({"type": "tool_result", "tool_use_id": call.id,
                                "content": json.dumps(output, ensure_ascii=False, default=str)})
            except Exception as exc:  # el error se le devuelve a Claude para que lo corrija
                db.rollback()
                log.warning("Herramienta %s falló: %s", call.name, exc)
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                "content": f"Error: {exc}"})
        api.append({"role": "user", "content": results})
    else:
        reply_text = "He necesitado demasiados pasos; prueba a concretar un poco más."

    reply = ChatMessage(role="assistant", text=reply_text or "Hecho.", actions=tools.actions)
    conv = db.merge(conv)
    conv.api_messages = api
    conv.messages = [*conv.messages, ChatMessage(role="user", text=text).model_dump(), reply.model_dump()]
    conv.updated_at = datetime.now(get_settings().tz)
    db.commit()
    return conv, reply
