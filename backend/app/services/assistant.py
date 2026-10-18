"""Asistente: conversa con Claude, que consulta y modifica tu segundo cerebro
mediante herramientas (buscar, ver la agenda, crear tareas, eventos y notas…)."""

import json
import logging
import uuid
from collections.abc import Iterator
from datetime import date, datetime, time
from typing import Any
from urllib.parse import quote

import anthropic
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Chunk, Conversation, Item, Task
from app.schemas import ChatAction, ChatMessage, EventIn, NoteIn, ReminderIn, TaskIn
from app.services import brain, vault
from app.services.calendar import events_between, local_day_bounds
from app.services.search import search

log = logging.getLogger(__name__)

MAX_STEPS = 10
# Modelos que admiten el reintento automático con otro modelo si uno rechaza la petición.
FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}

SYSTEM_PROMPT = """Eres Jarvis, el asistente personal de José Luis: su segundo cerebro. Conoces y manejas
su vault de Obsidian (su memoria: proyectos, áreas, recursos, diario), sus documentos (los de Descargas
se archivan solos en el vault), su calendario de Google, su Gmail, sus tareas y sus issues de GitHub.

Cómo trabajas:
- Hablas en español, con calidez y precisión, como un buen asistente de confianza: frases cortas,
  sin relleno, sin listas largas si no hacen falta. Tus respuestas también se leen en voz alta.
- Antes de responder sobre su vida, documentos o agenda, consulta con las herramientas. No supongas.
- Busca primero en su memoria (buscar) y lee las notas relevantes (leer_nota) antes de opinar.
- Cuando uses información de algo, nómbralo por su título para que pueda abrirlo.
- Actúas cuando te lo pide o cuando es claramente lo que quiere: crear tareas, eventos (van a Google
  Calendar), recordatorios, notas en el vault, apuntes en el diario. Dilo en una frase al terminar.
- En el vault sigues sus reglas: lo nuevo va a la Bandeja, el diario es 05-Diario/AAAA-MM-DD, se enlaza
  con [[wikilinks]] y nunca se borra nada.
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
    _tool("buscar", "Busca en todo el segundo cerebro (documentos, notas, tareas, eventos y correos) por palabras y "
          "significado. Devuelve los elementos más relevantes con un fragmento.",
          {"consulta": _S,
           "tipo": {"type": ["string", "null"], "enum": ["document", "note", "task", "event", "email", "vault", None]}},
          ["consulta", "tipo"]),
    _tool("leer_nota", "Lee una nota del vault de Obsidian por su título (como en un [[wikilink]]) o su ruta.",
          {"nota": _S}, ["nota"]),
    _tool("correo_pendiente", "Correos de la bandeja de entrada de Gmail que requieren atención (sin leer, importantes "
          "o destacados en Principal), del más reciente al más antiguo.", {}, []),
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
    _tool("crear_nota", "Guarda una nota en markdown en el vault (en la Bandeja). Enlaza con [[wikilinks]] a lo "
          "relacionado.", {"titulo": _S, "contenido": _S}, ["titulo", "contenido"]),
    _tool("crear_recordatorio", "Programa un aviso push a una hora concreta (AAAA-MM-DDTHH:MM, hora local).",
          {"texto": _S, "cuando": _S}, ["texto", "cuando"]),
    _tool("escribir_en_diario", "Añade una línea a la nota diaria de hoy en el vault, en la sección indicada "
          "('Notas y capturas', 'Hecho hoy', 'Foco del día' o 'Reflexión').",
          {"texto": _S, "seccion": {"type": ["string", "null"]}}, ["texto", "seccion"]),
]

_LINKS = {"document": "/documentos/{id}", "note": "/notas/{id}", "task": "/tareas?t={id}",
          "event": "/calendario?evento={id}", "email": "/bandeja?correo={id}"}


def _link(item: Item) -> str:
    if item.kind == "vault" and item.vault_note:
        return f"/memoria?nota={quote(item.vault_note.path)}"
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
                     "archivado_en": (item.entities or {}).get("filed_to"), "texto": text[:12000]}
        elif item.kind == "note":
            data["contenido"] = item.note.body[:12000]
        elif item.kind == "task":
            data |= brain.task_out(item).model_dump(mode="json")
        elif item.kind == "event":
            data |= brain.event_item_out(item).model_dump(mode="json")
        elif item.kind == "vault" and item.vault_note:
            data |= {"ruta": item.vault_note.path, "contenido": item.vault_note.body[:12000]}
        elif item.kind == "email" and item.email:
            data |= {"de": item.email.sender_name or item.email.sender_email, "extracto": item.email.snippet,
                     "recibido": _fmt_dt(item.email.received_at)}
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

    def t_correo_pendiente(self) -> list[dict]:
        from app.routers.integrations import inbox_list

        emails = inbox_list(self.db, "attention", 25)
        self.actions.append(ChatAction(tool="correo_pendiente", summary=f"Revisó el correo: {len(emails)} pendientes",
                                       link="/bandeja"))
        return [{"id": str(e.item_id), "asunto": e.item.title, "de": e.sender_name or e.sender_email,
                 "recibido": _fmt_dt(e.received_at), "extracto": e.snippet, "sin_leer": e.unread} for e in emails]

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

    def t_leer_nota(self, nota: str) -> dict:
        note = vault.find_note(self.db, nota)
        if note is None:
            return {"error": f"No hay ninguna nota «{nota}» en el vault"}
        self.actions.append(ChatAction(tool="leer_nota", summary=f"Leyó «{note.item.title}»",
                                       link=f"/memoria?nota={quote(note.path)}"))
        return {"ruta": note.path, "titulo": note.item.title, "frontmatter": note.frontmatter, "contenido": note.body[:15000]}

    def t_crear_nota(self, titulo: str, contenido: str):
        if vault.root() is not None:
            path = vault.capture(self.db, titulo, contenido)
            self.actions.append(ChatAction(tool="crear_nota", summary=f"Guardó «{titulo}» en la Bandeja del vault",
                                           link=f"/memoria?nota={quote(path)}"))
            return {"ruta": path, "ok": True}
        item = brain.create_note(self.db, NoteIn(title=titulo, body=contenido))
        self.actions.append(ChatAction(tool="crear_nota", summary=f"Guardó la nota «{item.title}»", link=_link(item)))
        return {"id": str(item.id), "ok": True}

    def t_crear_recordatorio(self, texto: str, cuando: str):
        r = brain.create_reminder(self.db, ReminderIn(title=texto, remind_at=_local(cuando)))
        self.actions.append(ChatAction(tool="crear_recordatorio",
                                       summary=f"Te avisará el {_fmt_dt(r.remind_at)}: {r.title}", link="/hoy"))
        return {"id": str(r.id), "ok": True}

    def t_escribir_en_diario(self, texto: str, seccion: str | None = None):
        today = datetime.now(get_settings().tz).date()
        if vault.root() is not None:
            path = vault.append_daily(self.db, texto, seccion or "Notas y capturas", today)
            self.actions.append(ChatAction(tool="escribir_en_diario", summary="Apuntó en el diario de hoy",
                                           link=f"/memoria?nota={quote(path)}"))
            return {"ok": True, "ruta": path}
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


def _params(messages: list[dict]) -> dict:
    return dict(
        model=get_settings().chat_model,
        max_tokens=16000,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        tools=TOOLS,
        messages=messages,
        output_config={"effort": "medium"},
    )


def _stream(client: anthropic.Anthropic, messages: list[dict]):
    params = _params(messages)
    if params["model"] in FALLBACK_MODELS:
        return client.beta.messages.stream(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
    return client.messages.stream(**params)


def chat_events(db: Session, text: str, conversation_id: uuid.UUID | None) -> Iterator[dict]:
    """La conversación como eventos, para verla en directo:
    start → (step → text… → action…)* → done. El texto llega a trozos mientras Claude escribe."""
    client = _client()
    conv = db.get(Conversation, conversation_id) if conversation_id else None
    if conv is None:
        conv = Conversation(title=text.strip()[:80], messages=[], api_messages=[])
        db.add(conv)
        db.commit()
    yield {"type": "start", "conversation_id": str(conv.id)}

    now = datetime.now(get_settings().tz)
    weekday = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"][now.weekday()]
    api = list(conv.api_messages)
    api.append({"role": "user", "content": f"[Ahora: {weekday} {now.strftime('%Y-%m-%d %H:%M')}]\n{text}"})

    tools = Toolbox(db)
    reply_text = ""
    for _ in range(MAX_STEPS):
        yield {"type": "step"}
        with _stream(client, api) as stream:
            for delta in stream.text_stream:
                yield {"type": "text", "delta": delta}
            response = stream.get_final_message()
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
            yield {"type": "tool", "tool": call.name}
            before = len(tools.actions)
            try:
                output = tools.run(call.name, dict(call.input))
                results.append({"type": "tool_result", "tool_use_id": call.id,
                                "content": json.dumps(output, ensure_ascii=False, default=str)})
            except Exception as exc:  # el error se le devuelve a Claude para que lo corrija
                db.rollback()
                log.warning("Herramienta %s falló: %s", call.name, exc)
                results.append({"type": "tool_result", "tool_use_id": call.id, "is_error": True,
                                "content": f"Error: {exc}"})
            for action in tools.actions[before:]:
                yield {"type": "action", "action": action.model_dump()}
        api.append({"role": "user", "content": results})
    else:
        reply_text = "He necesitado demasiados pasos; prueba a concretar un poco más."

    reply = ChatMessage(role="assistant", text=reply_text or "Hecho.", actions=tools.actions)
    conv = db.merge(conv)
    conv.api_messages = api
    conv.messages = [*conv.messages, ChatMessage(role="user", text=text).model_dump(), reply.model_dump()]
    conv.updated_at = datetime.now(get_settings().tz)
    db.commit()
    yield {"type": "done", "conversation_id": str(conv.id), "reply": reply.model_dump()}


def chat(db: Session, text: str, conversation_id: uuid.UUID | None) -> tuple[Conversation, ChatMessage]:
    done: dict = {}
    for event in chat_events(db, text, conversation_id):
        if event["type"] == "done":
            done = event
    conv = db.get(Conversation, uuid.UUID(done["conversation_id"]))
    return conv, ChatMessage.model_validate(done["reply"])
