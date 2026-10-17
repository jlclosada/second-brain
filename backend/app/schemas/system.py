import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str = Field(max_length=500)
    totp: str | None = Field(default=None, max_length=10)


class MeOut(BaseModel):
    user: str
    totp_enabled: bool
    ai_enabled: bool
    timezone: str
    session_id: uuid.UUID
    prefs: dict[str, Any]


class PasswordChange(BaseModel):
    current: str = Field(max_length=500)
    new: str = Field(max_length=500)


class TotpSetupOut(BaseModel):
    secret: str
    uri: str
    qr_svg: str


class TotpCode(BaseModel):
    code: str = Field(min_length=6, max_length=10)
    password: str | None = Field(default=None, max_length=500)


class SessionOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool


class AuditOut(BaseModel):
    at: datetime
    action: str
    ip: str | None
    detail: dict


class PrefsUpdate(BaseModel):
    default_event_reminder: int | None = Field(default=None, ge=0, le=60 * 24)
    briefing_hour: int | None = Field(default=None, ge=0, le=23)
    expiry_warning_days: list[int] | None = None


class NotificationOut(BaseModel):
    id: uuid.UUID
    kind: str
    title: str
    body: str | None
    url: str | None
    created_at: datetime
    read_at: datetime | None


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: dict[str, str]


class FeedOut(BaseModel):
    url_path: str


# --- Asistente ----------------------------------------------------------------

class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversation_id: uuid.UUID | None = None


class ChatAction(BaseModel):
    """Algo que el asistente hizo o consultó, para enseñarlo en la interfaz."""

    tool: str
    summary: str
    link: str | None = None


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str
    actions: list[ChatAction] = Field(default_factory=list)


class ChatOut(BaseModel):
    conversation_id: uuid.UUID
    reply: ChatMessage


class ConversationOut(BaseModel):
    id: uuid.UUID
    title: str
    updated_at: datetime


class ConversationDetail(ConversationOut):
    messages: list[ChatMessage]
