"""Conexiones con servicios externos (Google, GitHub) y el correo sincronizado."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Integration(Base):
    """Una fila por servicio conectado. Los secretos (tokens, credenciales de la
    app OAuth) se guardan cifrados con la clave de la instalación."""

    __tablename__ = "integrations"

    provider: Mapped[str] = mapped_column(String(20), primary_key=True)  # google | github
    # Credenciales de la app OAuth (client_id/secret) si se dieron desde Ajustes y no por .env
    client_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    # Tokens de acceso de la cuenta conectada
    secret_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    account: Mapped[str | None] = mapped_column(Text)  # correo de Google o usuario de GitHub
    scopes: Mapped[str | None] = mapped_column(Text)
    # ok | error | reconnect (el permiso se revocó o caducó: hay que volver a conectar)
    status: Mapped[str] = mapped_column(String(20), default="ok")
    error: Mapped[str | None] = mapped_column(Text)
    # Marcas de la última sincronización de cada parte (gmail, calendar…)
    state: Mapped[dict] = mapped_column(JSONB, default=dict)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Email(Base):
    """Un hilo de la bandeja de entrada de Gmail. Es un espejo: si sale de la
    bandeja en Gmail (archivado, borrado) desaparece también de aquí."""

    __tablename__ = "emails"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    thread_id: Mapped[str] = mapped_column(String(40), unique=True)
    history_id: Mapped[str | None] = mapped_column(String(40))
    sender_name: Mapped[str | None] = mapped_column(Text)
    sender_email: Mapped[str | None] = mapped_column(Text)
    snippet: Mapped[str] = mapped_column(Text, default="")
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    unread: Mapped[bool] = mapped_column(Boolean, default=False)
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    important: Mapped[bool] = mapped_column(Boolean, default=False)
    # primary | updates | promotions | social | forums
    category: Mapped[str] = mapped_column(String(20), default="primary", index=True)
    message_count: Mapped[int] = mapped_column(Integer, default=1)
    # La tarea creada a partir de este correo, si la hay.
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("items.id", ondelete="SET NULL"))

    item = relationship("Item", back_populates="email", foreign_keys=[item_id])
