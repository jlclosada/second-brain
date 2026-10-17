import uuid
from datetime import date, datetime, time
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

COLORS = ("cobalt", "ochre", "moss", "clay", "plum", "slate", "teal", "rose")
Color = Literal["cobalt", "ochre", "moss", "clay", "plum", "slate", "teal", "rose"]


def _valid_rrule(value: str | None) -> str | None:
    if not value:
        return None
    from dateutil.rrule import rrulestr

    value = value.removeprefix("RRULE:").strip()
    try:
        rrulestr(value, dtstart=datetime(2000, 1, 1))
    except (ValueError, TypeError):
        raise ValueError("Regla de repetición no válida") from None
    return value


class LinkRef(BaseModel):
    id: uuid.UUID
    kind: str
    title: str


# --- Proyectos ---------------------------------------------------------------

class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["project", "area"] = "project"
    color: Color = "cobalt"
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: Literal["project", "area"] | None = None
    color: Color | None = None
    description: str | None = None
    archived: bool | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: str
    color: str
    description: str | None
    archived_at: datetime | None
    open_tasks: int = 0
    notes: int = 0
    documents: int = 0


# --- Notas -------------------------------------------------------------------

class NoteIn(BaseModel):
    title: str = Field(default="", max_length=300)
    body: str = ""
    tags: list[str] = Field(default_factory=list)
    pinned: bool = False
    project_id: uuid.UUID | None = None


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    body: str | None = None
    tags: list[str] | None = None
    pinned: bool | None = None
    project_id: uuid.UUID | None = None


class NoteOut(BaseModel):
    id: uuid.UUID
    title: str
    body: str
    excerpt: str
    tags: list[str]
    pinned: bool
    project_id: uuid.UUID | None
    journal_date: date | None
    created_at: datetime
    updated_at: datetime


class NoteDetail(NoteOut):
    links: list[LinkRef]
    backlinks: list[LinkRef]


# --- Tareas ------------------------------------------------------------------

class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    notes: str = ""
    due_date: date | None = None
    due_time: time | None = None
    priority: int = Field(default=0, ge=0, le=3)
    rrule: str | None = None
    remind: bool = True
    tags: list[str] = Field(default_factory=list)
    project_id: uuid.UUID | None = None

    _rrule = field_validator("rrule")(_valid_rrule)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    notes: str | None = None
    due_date: date | None = None
    due_time: time | None = None
    priority: int | None = Field(default=None, ge=0, le=3)
    rrule: str | None = None
    remind: bool | None = None
    tags: list[str] | None = None
    project_id: uuid.UUID | None = None
    done: bool | None = None
    sort: float | None = None

    _rrule = field_validator("rrule")(_valid_rrule)


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    notes: str
    due_date: date | None
    due_time: time | None
    priority: int
    done_at: datetime | None
    rrule: str | None
    remind: bool
    tags: list[str]
    project_id: uuid.UUID | None
    sort: float
    created_at: datetime


# --- Calendario ----------------------------------------------------------------

class CalendarIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    color: Color = "cobalt"
    # Enlace privado iCal (Google, iCloud, Outlook). Vacío = calendario propio.
    url: str | None = None

    @field_validator("url")
    @classmethod
    def _url(cls, value: str | None) -> str | None:
        if not value:
            return None
        value = value.strip()
        if value.startswith("webcal://"):
            value = "https://" + value.removeprefix("webcal://")
        if not value.startswith(("https://", "http://")):
            raise ValueError("El enlace debe empezar por https:// o webcal://")
        return value


class CalendarUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    color: Color | None = None
    enabled: bool | None = None


class CalendarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str
    source: str
    enabled: bool
    last_synced_at: datetime | None
    sync_error: str | None
    events: int = 0


class EventIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    location: str | None = None
    description: str | None = None
    rrule: str | None = None
    remind_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 14)
    calendar_id: uuid.UUID | None = None
    tags: list[str] = Field(default_factory=list)
    project_id: uuid.UUID | None = None

    _rrule = field_validator("rrule")(_valid_rrule)


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool | None = None
    location: str | None = None
    description: str | None = None
    rrule: str | None = None
    remind_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 14)
    calendar_id: uuid.UUID | None = None
    tags: list[str] | None = None
    project_id: uuid.UUID | None = None

    _rrule = field_validator("rrule")(_valid_rrule)


class EventOut(BaseModel):
    id: uuid.UUID
    title: str
    calendar_id: uuid.UUID
    color: str
    source: str
    starts_at: datetime
    ends_at: datetime
    all_day: bool
    location: str | None
    description: str | None
    rrule: str | None
    remind_minutes: int | None
    tags: list[str]
    project_id: uuid.UUID | None
    # Para eventos que se repiten: cada ocurrencia sale por separado.
    recurring: bool = False


# --- Recordatorios ----------------------------------------------------------

class ReminderIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    remind_at: datetime
    item_id: uuid.UUID | None = None


class ReminderUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    remind_at: datetime | None = None
    dismissed: bool | None = None


class ReminderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    remind_at: datetime
    sent_at: datetime | None
    dismissed_at: datetime | None
    item_id: uuid.UUID | None


# --- Hoy -------------------------------------------------------------------------

class TodayOut(BaseModel):
    date: date
    timezone: str
    events: list[EventOut]
    overdue: list[TaskOut]
    due_today: list[TaskOut]
    reminders: list[ReminderOut]
    expiring: list["ExpiringDoc"]
    journal: NoteOut | None
    pinned_notes: list[NoteOut]
    recent: list[LinkRef]
    counts: dict[str, int]


class ExpiringDoc(BaseModel):
    id: uuid.UUID
    title: str
    category: str | None
    expires_on: date
    days_left: int


# --- Captura -----------------------------------------------------------------

class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    # Si es False solo interpreta y devuelve la propuesta, sin guardar.
    commit: bool = True


class CaptureOut(BaseModel):
    kind: Literal["task", "event", "note", "reminder"]
    title: str
    due_date: date | None = None
    due_time: time | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    all_day: bool = False
    remind_at: datetime | None = None
    body: str | None = None
    tags: list[str] = Field(default_factory=list)
    priority: int = 0
    parsed_by: Literal["claude", "reglas"]
    created_id: uuid.UUID | None = None


TodayOut.model_rebuild()
