"""Notas, tareas, calendario, proyectos y recordatorios."""

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Project(Base):
    """Proyecto (tiene un final) o área (responsabilidad continua: Salud, Casa…)."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(10), default="project")  # project | area
    color: Mapped[str] = mapped_column(String(20), default="cobalt")
    description: Mapped[str | None] = mapped_column(Text)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Note(Base):
    __tablename__ = "notes"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    body: Mapped[str] = mapped_column(Text, default="")
    # Solo para las entradas del diario: una por día.
    journal_date: Mapped[date | None] = mapped_column(Date, unique=True)

    item = relationship("Item", back_populates="note")


class Task(Base):
    __tablename__ = "tasks"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    notes: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[date | None] = mapped_column(Date, index=True)
    due_time: Mapped[time | None] = mapped_column(Time)
    # 0 sin prioridad, 1 baja, 2 media, 3 alta
    priority: Mapped[int] = mapped_column(SmallInteger, default=0)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    # Regla RFC 5545 (FREQ=WEEKLY;BYDAY=MO…). Al completarla avanza a la siguiente fecha.
    rrule: Mapped[str | None] = mapped_column(Text)
    remind: Mapped[bool] = mapped_column(Boolean, default=True)
    sort: Mapped[float] = mapped_column(Float, default=0)

    item = relationship("Item", back_populates="task", foreign_keys=[item_id])


class Calendar(Base):
    __tablename__ = "calendars"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(20), default="cobalt")
    source: Mapped[str] = mapped_column(String(10), default="local")  # local | ics
    # La URL privada iCal da acceso a tu agenda: se guarda cifrada.
    url_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("calendar_id", "external_key"),)

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    calendar_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("calendars.id", ondelete="CASCADE"), index=True
    )
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    location: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    rrule: Mapped[str | None] = mapped_column(Text)
    # Hasta cuándo se repite (para filtrar sin expandir la regla). None = sin fin.
    repeat_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Minutos de antelación del aviso; None = sin aviso.
    remind_minutes: Mapped[int | None] = mapped_column(Integer)
    # Para calendarios externos: UID + inicio de la ocurrencia.
    external_key: Mapped[str | None] = mapped_column(Text)

    item = relationship("Item", back_populates="event")
    calendar: Mapped[Calendar] = relationship()


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(Text)
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    item = relationship("Item")
