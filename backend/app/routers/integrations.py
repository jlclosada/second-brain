"""Conexiones (Google, GitHub) y la bandeja de entrada de Gmail."""

import uuid
from datetime import datetime
from typing import Literal
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Email, Integration, Item, Task, UserSession
from app.schemas import (
    EmailOut,
    EmailToTask,
    GitHubTokenIn,
    GoogleClientIn,
    InboxOut,
    IntegrationOut,
    IntegrationsOut,
    TaskIn,
    TaskOut,
)
from app.security import audit, current_session, require_user
from app.services import brain, github, google, icloud
from app.services.jobs import enqueue

router = APIRouter(prefix="/api", tags=["integrations"], dependencies=[Depends(require_user)])


def _base_url(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


def _out(row: Integration | None, provider: str, configured: bool = True, **extra) -> IntegrationOut:
    if row is None:
        return IntegrationOut(provider=provider, configured=configured, connected=False, **extra)
    return IntegrationOut(
        provider=provider, configured=configured, connected=bool(row.secret_encrypted),
        account=row.account, status=row.status, error=row.error, connected_at=row.connected_at,
        state=row.state or {}, **extra,
    )


@router.get("/integrations", response_model=IntegrationsOut)
def integrations(request: Request, db: Session = Depends(get_db)):
    settings = get_settings()
    google_out = _out(
        db.get(Integration, "google"), "google", configured=google.client_config(db) is not None,
        redirect_uri=google.redirect_uri(_base_url(request)),
        client_from_env=bool(settings.google_client_id and settings.google_client_secret),
    )
    return IntegrationsOut(google=google_out, github=_out(db.get(Integration, "github"), "github"),
                           icloud=_out(db.get(Integration, "icloud"), "icloud"))


# --- Google -----------------------------------------------------------------

@router.put("/integrations/google/client", status_code=status.HTTP_204_NO_CONTENT)
def set_google_client(body: GoogleClientIn, request: Request, db: Session = Depends(get_db)):
    if not body.client_id.endswith(".apps.googleusercontent.com"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "El Client ID de Google termina en .apps.googleusercontent.com")
    google.save_client_config(db, body.client_id, body.client_secret)
    db.commit()
    audit(db, "google_client_saved", request)


@router.get("/integrations/google/start")
def google_start(request: Request, session: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    try:
        return {"url": google.auth_url(db, session.id, _base_url(request))}
    except google.GoogleError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None


@router.get("/integrations/google/callback", include_in_schema=False)
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: UserSession = Depends(current_session),
    db: Session = Depends(get_db),
):
    """Google vuelve aquí tras aceptar (o rechazar) el permiso."""
    def back(result: str, message: str = "") -> RedirectResponse:
        suffix = f"&mensaje={quote(message[:200])}" if message else ""
        return RedirectResponse(f"/ajustes?seccion=conexiones&google={result}{suffix}", status_code=303)

    if error:
        return back("cancelado", "Cancelaste el permiso en Google" if error == "access_denied" else error)
    if not code or not state:
        return back("error", "Faltan datos en la respuesta de Google")
    try:
        google.check_state(state, session.id)
        row = google.finish_oauth(db, code, _base_url(request))
        db.commit()
    except google.GoogleError as exc:
        db.rollback()
        return back("error", str(exc))
    audit(db, "google_connected", request, account=row.account)
    return back("ok")


@router.delete("/integrations/google", status_code=status.HTTP_204_NO_CONTENT)
def google_disconnect(request: Request, forget_app: bool = False, db: Session = Depends(get_db)):
    google.disconnect(db)
    if forget_app:
        row = db.get(Integration, "google")
        if row is not None:
            db.delete(row)
    db.commit()
    audit(db, "google_disconnected", request)


@router.post("/integrations/{provider}/sync", status_code=status.HTTP_202_ACCEPTED)
def sync_now(provider: Literal["google", "github", "icloud"], db: Session = Depends(get_db)):
    row = db.get(Integration, provider)
    if row is None or not row.secret_encrypted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No está conectado")
    if provider == "google":
        google.schedule_google_sync(db, force=True)
    elif provider == "icloud":
        enqueue(db, "sync_icloud", {}, dedupe=True, max_attempts=1)
    else:
        enqueue(db, "sync_github", {}, dedupe=True, max_attempts=1)
    db.commit()
    return {"queued": True}


# --- iCloud (calendario del iPhone) ----------------------------------------------

class ICloudIn(BaseModel):
    apple_id: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=100)


@router.put("/integrations/icloud", response_model=IntegrationOut)
def icloud_connect(body: ICloudIn, request: Request, db: Session = Depends(get_db)):
    try:
        row = icloud.connect(db, body.apple_id, body.password)
    except (icloud.ICloudError, httpx.HTTPError) as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc) or "No se pudo conectar con iCloud") from None
    db.commit()
    audit(db, "icloud_connected", request, account=row.account)
    return _out(row, "icloud")


@router.delete("/integrations/icloud", status_code=status.HTTP_204_NO_CONTENT)
def icloud_disconnect(request: Request, db: Session = Depends(get_db)):
    icloud.disconnect(db)
    db.commit()
    audit(db, "icloud_disconnected", request)


# --- GitHub -----------------------------------------------------------------

@router.put("/integrations/github", response_model=IntegrationOut)
def github_connect(body: GitHubTokenIn, request: Request, db: Session = Depends(get_db)):
    try:
        row = github.connect(db, body.token)
    except (github.GitHubError, httpx.HTTPError) as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc) or "No se pudo conectar con GitHub") from None
    db.commit()
    audit(db, "github_connected", request, account=row.account)
    return _out(row, "github")


@router.delete("/integrations/github", status_code=status.HTTP_204_NO_CONTENT)
def github_disconnect(request: Request, db: Session = Depends(get_db)):
    github.disconnect(db)
    db.commit()
    audit(db, "github_disconnected", request)


# --- Bandeja de entrada -------------------------------------------------------

ATTENTION = (Email.category == "primary") & Email.task_id.is_(None) & (
    Email.unread.is_(True) | Email.important.is_(True) | Email.starred.is_(True)
)


def email_out(email: Email, account: str | None) -> EmailOut:
    return EmailOut(
        id=email.item_id, thread_id=email.thread_id, subject=email.item.title, sender_name=email.sender_name,
        sender_email=email.sender_email, snippet=email.snippet, received_at=email.received_at, unread=email.unread,
        starred=email.starred, important=email.important, category=email.category,
        message_count=email.message_count, url=google.gmail_link(email.thread_id, account), task_id=email.task_id,
        needs_attention=email.category == "primary" and email.task_id is None
        and (email.unread or email.important or email.starred),
    )


def inbox_counts(db: Session) -> dict[str, int]:
    def count(where) -> int:
        return db.scalar(select(func.count()).select_from(Email).where(where)) or 0

    return {
        "attention": count(ATTENTION),
        "primary": count(Email.category == "primary"),
        "other": count(Email.category != "primary"),
        "unread": count(Email.unread.is_(True) & (Email.category == "primary")),
        "all": count(Email.item_id.is_not(None)),
    }


def inbox_list(db: Session, view: str, limit: int) -> list[Email]:
    where = {
        "attention": ATTENTION,
        "primary": Email.category == "primary",
        "other": Email.category != "primary",
    }.get(view)
    query = select(Email).join(Item, Item.id == Email.item_id)
    if where is not None:
        query = query.where(where)
    return db.scalars(query.order_by(Email.received_at.desc()).limit(limit)).all()


@router.get("/inbox", response_model=InboxOut)
def inbox(view: Literal["attention", "primary", "other", "all"] = "attention", limit: int = Query(100, le=200),
          db: Session = Depends(get_db)):
    row = db.get(Integration, "google")
    state = (row.state or {}) if row else {}
    synced = state.get("gmail_synced_at")
    return InboxOut(
        connected=bool(row and row.secret_encrypted), account=row.account if row else None,
        synced_at=datetime.fromisoformat(synced) if synced else None,
        error=state.get("gmail_error") or (row.error if row and row.status == "reconnect" else None),
        counts=inbox_counts(db),
        emails=[email_out(e, row.account if row else None) for e in inbox_list(db, view, limit)],
    )


def _email(db: Session, item_id: uuid.UUID) -> Email:
    email = db.get(Email, item_id)
    if email is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ese correo ya no está en la bandeja")
    return email


def _google_call(fn) -> None:
    try:
        fn()
    except google.GoogleError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gmail: {exc}") from None


@router.post("/inbox/{item_id}/archive", status_code=status.HTTP_204_NO_CONTENT)
def archive(item_id: uuid.UUID, db: Session = Depends(get_db)):
    email = _email(db, item_id)
    _google_call(lambda: google.archive_email(db, email))
    db.commit()


@router.post("/inbox/{item_id}/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(item_id: uuid.UUID, unread: bool = False, db: Session = Depends(get_db)):
    email = _email(db, item_id)
    _google_call(lambda: google.mark_read(db, email, read=not unread))
    db.commit()


@router.post("/inbox/{item_id}/task", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def to_task(item_id: uuid.UUID, body: EmailToTask, db: Session = Depends(get_db)):
    email = _email(db, item_id)
    row = db.get(Integration, "google")
    url = google.gmail_link(email.thread_id, row.account if row else None)
    sender = email.sender_name or email.sender_email or "alguien"
    # Por defecto para hoy: si no, quedaría escondida entre las tareas sin fecha.
    tz = get_settings().tz
    due = body.due_date.astimezone(tz).date() if body.due_date else datetime.now(tz).date()
    task_item = brain.create_task(db, TaskIn(
        title=f"Responder a {sender}: {email.item.title}"[:300],
        notes=f"Correo de {sender} ({email.sender_email or ''}):\n\n{email.snippet}",
        due_date=due, tags=["correo"],
    ))
    task_item.task.source = "gmail"
    task_item.task.external_id = email.thread_id
    task_item.task.external_url = url
    email = db.get(Email, item_id)
    email.task_id = task_item.id
    if body.archive:
        _google_call(lambda: google.archive_email(db, email))
    db.commit()
    return brain.task_out(task_item)


class DraftSend(BaseModel):
    email_id: uuid.UUID | None = None
    # Si se editó en la interfaz, el texto final; si no, se envía tal cual está en Gmail.
    body: str | None = Field(default=None, max_length=50000)


@router.post("/inbox/drafts/{draft_id}/send", status_code=status.HTTP_204_NO_CONTENT)
def send_draft(draft_id: str, body: DraftSend, request: Request, db: Session = Depends(get_db)):
    """Enviar una respuesta que redactó Jarvis. Solo ocurre con este clic."""
    email = db.get(Email, body.email_id) if body.email_id else None
    _google_call(lambda: google.send_draft(db, draft_id, email, body.body))
    if email is not None:
        email.unread = False
    db.commit()
    audit(db, "email_sent", request, draft=draft_id)


def task_from_github(db: Session) -> dict[str, list[TaskOut]]:
    """Para Hoy: revisiones pendientes y lo asignado en GitHub."""
    rows = db.scalars(
        select(Item).join(Task, Task.item_id == Item.id)
        .where(Task.source == "github", Task.done_at.is_(None))
        .order_by(Task.priority.desc(), Item.created_at.desc())
    ).all()
    reviews = [brain.task_out(i) for i in rows if "revision" in (i.tags or [])]
    assigned = [brain.task_out(i) for i in rows if "revision" not in (i.tags or [])]
    return {"reviews": reviews, "assigned": assigned}
