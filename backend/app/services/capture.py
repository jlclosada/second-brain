"""Captura rápida: una frase se convierte en tarea, evento, nota o recordatorio.

"Dentista el martes a las 10" → evento; "pagar el IBI el 5 de noviembre" →
tarea con fecha; "nota: idea para el viaje…" → nota. Con clave de API lo
interpreta Claude; si no, unas reglas en español.
"""

import logging
import re
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal

import anthropic
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import get_settings
from app.schemas import CaptureOut, EventIn, NoteIn, ReminderIn, TaskIn
from app.services import brain
from app.services.when import fold, parse

log = logging.getLogger(__name__)

EVENT_WORDS = (
    "reunion", "cita", "cena", "comida", "almuerzo", "desayuno", "quedada", "quedar", "medico", "dentista",
    "cumpleanos", "vuelo", "boda", "partido", "clase", "entrevista", "concierto", "evento", "viaje", "consulta",
    "llamada con", "videollamada", "tutoria", "examen",
)
REMINDER_WORDS = ("recuerdame", "recordarme", "recordatorio", "avisame", "no olvidar", "no olvides")
NOTE_PREFIX = re.compile(r"^\s*(nota|idea|apunte|pensamiento)\s*[:\-]\s*", re.IGNORECASE)
TAG_RE = re.compile(r"(?<!\w)#([\wáéíóúñü\-]{2,30})", re.IGNORECASE)


class CaptureParse(BaseModel):
    kind: Literal["task", "event", "note", "reminder"] = Field(
        description="event si tiene hora y es algo a lo que se asiste; reminder si pide que se le avise; "
                    "note si es una idea o información; task en el resto de casos"
    )
    title: str = Field(description="Título breve y claro, sin la fecha ni la hora")
    date: str | None = Field(default=None, description="AAAA-MM-DD")
    time: str | None = Field(default=None, description="HH:MM en 24 horas")
    end_time: str | None = Field(default=None, description="HH:MM si se indica cuándo termina")
    all_day: bool = False
    body: str | None = Field(default=None, description="Para notas: el contenido completo")
    tags: list[str] = Field(default_factory=list)
    priority: int = Field(default=0, description="0 sin prioridad, 3 si es urgente")


def _rules(text: str, now: datetime) -> CaptureParse:
    tags = [t.lower() for t in TAG_RE.findall(text)]
    clean = TAG_RE.sub("", text).strip()
    if NOTE_PREFIX.match(clean):
        body = NOTE_PREFIX.sub("", clean, count=1)
        return CaptureParse(kind="note", title="", body=body, tags=tags)

    priority = 3 if re.search(r"(!{1,3}\s*$|\burgente\b)", clean, re.IGNORECASE) else 0
    clean = re.sub(r"(!{1,3}\s*$|\burgente\b)", "", clean, flags=re.IGNORECASE).strip()
    when = parse(clean, now)
    folded = fold(clean)
    title = when.rest or clean
    title = re.sub(r"^(recu[eé]rdame|recordarme|av[ií]same|recordatorio:?)\s+(que\s+)?", "", title, flags=re.IGNORECASE)
    title = title[:1].upper() + title[1:]

    if any(w in folded for w in REMINDER_WORDS) and when.at is not None:
        kind = "reminder"
    elif any(w in folded for w in EVENT_WORDS) and when.day is not None:
        kind = "event"
    else:
        kind = "task"
    return CaptureParse(
        kind=kind, title=title, date=when.day.isoformat() if when.day else None,
        time=when.at.strftime("%H:%M") if when.at else None,
        end_time=when.end_at.strftime("%H:%M") if when.end_at else None,
        all_day=kind == "event" and when.at is None, tags=tags, priority=priority,
    )


CLAUDE_PROMPT = """Conviertes frases rápidas en español en un elemento de una agenda personal.
Hoy es {today} ({weekday}) y son las {now} en {tz}. Interpreta las fechas relativas a partir de ahí
("el martes" es el próximo martes). No inventes fechas ni horas que la frase no indique."""


def _claude(text: str, now: datetime) -> CaptureParse | None:
    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    weekdays = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    response = client.messages.parse(
        model=settings.classify_model,
        max_tokens=1024,
        system=CLAUDE_PROMPT.format(today=now.date().isoformat(), weekday=weekdays[now.weekday()],
                                    now=now.strftime("%H:%M"), tz=settings.timezone),
        messages=[{"role": "user", "content": text}],
        output_format=CaptureParse,
    )
    if response.stop_reason == "refusal":
        return None
    return response.parsed_output


def interpret(text: str) -> tuple[CaptureParse, str]:
    settings = get_settings()
    now = datetime.now(settings.tz).replace(tzinfo=None)
    if settings.anthropic_api_key:
        try:
            parsed = _claude(text, now)
            if parsed is not None:
                return parsed, "claude"
        except anthropic.APIError as exc:
            log.warning("Captura con Claude fallida, se usan reglas: %s", exc)
    return _rules(text, now), "reglas"


def _d(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value) if value else None
    except ValueError:
        return None


def _t(value: str | None) -> time | None:
    try:
        return time.fromisoformat(value) if value else None
    except ValueError:
        return None


def capture(db: Session, text: str, commit: bool = True) -> CaptureOut:
    parsed, by = interpret(text)
    tz = get_settings().tz
    day, at, end = _d(parsed.date), _t(parsed.time), _t(parsed.end_time)
    out = CaptureOut(kind=parsed.kind, title=parsed.title, tags=brain.clean_tags(parsed.tags),
                     priority=max(0, min(3, parsed.priority)), parsed_by=by)

    if parsed.kind == "event" and day is None:
        out.kind = "task"
    if parsed.kind == "reminder" and at is None:
        out.kind = "task"

    if out.kind == "note":
        out.body = parsed.body or text
        if commit:
            out.created_id = brain.create_note(db, NoteIn(title=parsed.title, body=out.body, tags=out.tags)).id
    elif out.kind == "event":
        starts = datetime.combine(day, at or time.min, tzinfo=tz)
        ends = datetime.combine(day, end, tzinfo=tz) if end else None
        if ends and ends <= starts:
            ends += timedelta(days=1)
        all_day = at is None
        out.starts_at, out.ends_at, out.all_day = starts, ends, all_day
        if commit:
            item = brain.create_event(db, EventIn(
                title=parsed.title, starts_at=starts, ends_at=ends, all_day=all_day, tags=out.tags,
                remind_minutes=None if all_day else 30,
            ))
            out.created_id = item.id
            out.starts_at, out.ends_at = item.event.starts_at, item.event.ends_at
    elif out.kind == "reminder":
        remind_at = datetime.combine(day or datetime.now(tz).date(), at, tzinfo=tz)
        out.remind_at = remind_at.astimezone(UTC)
        if commit:
            out.created_id = brain.create_reminder(db, ReminderIn(title=parsed.title, remind_at=remind_at)).id
    else:
        out.due_date, out.due_time = day, at if day else None
        if commit:
            out.created_id = brain.create_task(db, TaskIn(
                title=parsed.title or text, due_date=day, due_time=out.due_time, tags=out.tags,
                priority=out.priority,
            )).id
    return out
