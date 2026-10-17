"""Cuenta, sesiones, seguridad, cola de trabajos y notificaciones."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Account(Base):
    """El dueño del segundo cerebro. Siempre hay una sola fila (id = 1)."""

    __tablename__ = "account"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    password_hash: Mapped[str] = mapped_column(Text)
    totp_secret_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    # Enlace privado para suscribirse al calendario desde el móvil.
    feed_token: Mapped[str] = mapped_column(String(64))
    vapid_private_pem: Mapped[str | None] = mapped_column(Text)
    vapid_public_key: Mapped[str | None] = mapped_column(Text)
    prefs: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ip: Mapped[str] = mapped_column(INET, index=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    success: Mapped[bool] = mapped_column(Boolean)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    action: Mapped[str] = mapped_column(String(60))
    ip: Mapped[str | None] = mapped_column(INET)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)


class Job(Base):
    """Cola de trabajos en Postgres. Varios workers la consumen con SKIP LOCKED."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    # queued | running | done | failed
    status: Mapped[str] = mapped_column(String(10), default="queued")
    run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    last_error: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(20))  # reminder | event | task | expiry | briefing | system
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str | None] = mapped_column(Text)
    # Evita avisar dos veces de lo mismo aunque haya varios workers.
    dedupe_key: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(Text)
    auth: Mapped[str] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_error: Mapped[str | None] = mapped_column(Text)


class Conversation(Base):
    """Conversación con el asistente."""

    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(Text)
    # Lo que ve la persona: texto y acciones realizadas.
    messages: Mapped[list] = mapped_column(JSONB, default=list)
    # Historial tal cual lo usa la API (bloques de herramientas incluidos), solo se añade al final.
    api_messages: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True
    )
