"""Conexión con Google: OAuth, Gmail (bandeja de entrada) y Google Calendar
(lectura y escritura).

Se habla con las APIs REST directamente con httpx. Los tokens se guardan
cifrados en `integrations` y se renuevan solos con el refresh token.
"""

import base64
import colorsys
import json
import logging
import re
import secrets
import uuid
from datetime import UTC, date, datetime, time, timedelta
from email.message import EmailMessage
from email.utils import parseaddr
from html import unescape
from urllib.parse import quote, urlencode

import httpx
import jwt
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import get_settings
from app.models import Calendar, Email, Event, Integration, Item
from app.security import decrypt, encrypt
from app.services.indexing import schedule_index
from app.services.jobs import enqueue, handler

log = logging.getLogger(__name__)

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
GCAL = "https://www.googleapis.com/calendar/v3"
SCOPES = [
    "openid",
    "email",
    # Leer la bandeja, marcar como leído y archivar (no permite borrar para siempre).
    "https://www.googleapis.com/auth/gmail.modify",
    # Ver y editar eventos de tus calendarios.
    "https://www.googleapis.com/auth/calendar",
]
CALLBACK_PATH = "/api/integrations/google/callback"

INBOX_QUERY = "in:inbox newer_than:30d"
INBOX_MAX = 100
SYNC_PAST = timedelta(days=60)
SYNC_FUTURE = timedelta(days=365)

# En los tests se sustituye por un httpx.MockTransport.
transport: httpx.BaseTransport | None = None


class GoogleError(Exception):
    pass


class NeedsReconnect(GoogleError):
    """El permiso ya no vale (revocado o caducado): hay que volver a conectar."""


def _http() -> httpx.Client:
    return httpx.Client(timeout=30, transport=transport, headers={"User-Agent": "SegundoCerebro/1.0"})


# --- Credenciales de la app OAuth ------------------------------------------------

def integration(db: Session, provider: str = "google", create: bool = False) -> Integration | None:
    row = db.get(Integration, provider)
    if row is None and create:
        row = Integration(provider=provider, status="ok", state={})
        db.add(row)
        db.flush()
    return row


def client_config(db: Session) -> tuple[str, str] | None:
    """(client_id, client_secret): de .env o, si no, los guardados desde Ajustes."""
    settings = get_settings()
    if settings.google_client_id and settings.google_client_secret:
        return settings.google_client_id, settings.google_client_secret
    row = integration(db)
    raw = decrypt(row.client_encrypted) if row else None
    if raw:
        data = json.loads(raw)
        return data["client_id"], data["client_secret"]
    return None


def save_client_config(db: Session, client_id: str, client_secret: str) -> None:
    row = integration(db, create=True)
    row.client_encrypted = encrypt(json.dumps({"client_id": client_id.strip(), "client_secret": client_secret.strip()}))


def is_connected(db: Session) -> bool:
    row = integration(db)
    return bool(row and row.secret_encrypted)


def redirect_uri(base_url: str) -> str:
    base = (get_settings().public_url or base_url).rstrip("/")
    return base + CALLBACK_PATH


# --- OAuth ------------------------------------------------------------------------

def auth_url(db: Session, session_id: uuid.UUID, base_url: str) -> str:
    config = client_config(db)
    if config is None:
        raise GoogleError("Falta configurar la app de Google (Client ID y Client secret)")
    # El estado va firmado y atado a la sesión: nadie puede colarte su cuenta.
    state = jwt.encode(
        {"sid": str(session_id), "n": secrets.token_urlsafe(12), "exp": datetime.now(UTC) + timedelta(minutes=15)},
        get_settings().signing_key(), algorithm="HS256",
    )
    params = {
        "client_id": config[0],
        "redirect_uri": redirect_uri(base_url),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def check_state(state: str, session_id: uuid.UUID) -> None:
    try:
        payload = jwt.decode(state, get_settings().signing_key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise GoogleError("El enlace de conexión ha caducado. Vuelve a intentarlo.") from None
    if payload.get("sid") != str(session_id):
        raise GoogleError("La conexión se empezó desde otra sesión")


def finish_oauth(db: Session, code: str, base_url: str) -> Integration:
    config = client_config(db)
    if config is None:
        raise GoogleError("Falta configurar la app de Google")
    with _http() as http:
        r = http.post(TOKEN_URL, data={
            "code": code, "client_id": config[0], "client_secret": config[1],
            "redirect_uri": redirect_uri(base_url), "grant_type": "authorization_code",
        })
        if r.status_code != 200:
            raise GoogleError(f"Google no aceptó la conexión: {_google_message(r)}")
        tokens = r.json()
        info = http.get(USERINFO_URL, headers={"Authorization": f"Bearer {tokens['access_token']}"})
        email = info.json().get("email") if info.status_code == 200 else None

    granted = set(tokens.get("scope", "").split())
    missing = [s for s in SCOPES[2:] if s not in granted]
    row = integration(db, create=True)
    previous = json.loads(decrypt(row.secret_encrypted) or "{}")
    refresh = tokens.get("refresh_token") or previous.get("refresh_token")
    if not refresh:
        raise GoogleError("Google no devolvió permiso permanente. Quita el acceso en tu cuenta de Google y vuelve a conectar.")
    if row.account and email and row.account != email:
        # Otra cuenta distinta: se empieza de cero para no mezclar correos y calendarios.
        _forget_google_data(db)
        row.state = {}
    row.secret_encrypted = encrypt(json.dumps({
        "access_token": tokens["access_token"],
        "refresh_token": refresh,
        "expires_at": (datetime.now(UTC) + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)).isoformat(),
    }))
    row.account = email
    row.scopes = " ".join(sorted(granted))
    row.status = "ok"
    row.error = (
        "No diste todos los permisos: " + ", ".join("Gmail" if "gmail" in s else "Calendar" for s in missing)
        if missing else None
    )
    row.connected_at = datetime.now(UTC)
    db.flush()
    schedule_google_sync(db, force=True)
    return row


def disconnect(db: Session) -> None:
    row = integration(db)
    if row is None:
        return
    tokens = json.loads(decrypt(row.secret_encrypted) or "{}")
    token = tokens.get("refresh_token") or tokens.get("access_token")
    if token:
        try:
            with _http() as http:
                http.post(REVOKE_URL, params={"token": token})
        except httpx.HTTPError:
            log.warning("No se pudo revocar el permiso en Google")
    _forget_google_data(db)
    row.secret_encrypted = None
    row.account = None
    row.scopes = None
    row.status = "ok"
    row.error = None
    row.state = {}
    row.connected_at = None


def _forget_google_data(db: Session) -> None:
    for item in db.scalars(select(Item).where(Item.kind == "email")):
        db.delete(item)
    for cal in db.scalars(select(Calendar).where(Calendar.source == "google")):
        for item_id in db.scalars(select(Event.item_id).where(Event.calendar_id == cal.id)).all():
            db.delete(db.get(Item, item_id))
        db.delete(cal)
    db.flush()


def _google_message(r: httpx.Response) -> str:
    try:
        body = r.json()
    except ValueError:
        return f"HTTP {r.status_code}"
    err = body.get("error")
    if isinstance(err, dict):
        return err.get("message") or str(err.get("code"))
    return body.get("error_description") or str(err or r.status_code)


# --- Cliente con renovación automática ---------------------------------------------

class Google:
    """Hace peticiones a las APIs de Google renovando el token cuando caduca."""

    def __init__(self, db: Session):
        self.db = db
        self.row = integration(db)
        if self.row is None or not self.row.secret_encrypted:
            raise NeedsReconnect("Google no está conectado")
        self.tokens = json.loads(decrypt(self.row.secret_encrypted) or "{}")
        if not self.tokens.get("refresh_token"):
            raise NeedsReconnect("Falta el permiso de Google")
        self.http = _http()

    def close(self) -> None:
        self.http.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _refresh(self) -> None:
        config = client_config(self.db)
        if config is None:
            raise NeedsReconnect("Falta configurar la app de Google")
        r = self.http.post(TOKEN_URL, data={
            "client_id": config[0], "client_secret": config[1],
            "refresh_token": self.tokens["refresh_token"], "grant_type": "refresh_token",
        })
        if r.status_code in (400, 401):
            raise NeedsReconnect(f"Google pide volver a conectar ({_google_message(r)})")
        if r.status_code != 200:
            raise GoogleError(f"No se pudo renovar el acceso: {_google_message(r)}")
        data = r.json()
        self.tokens["access_token"] = data["access_token"]
        self.tokens["expires_at"] = (
            datetime.now(UTC) + timedelta(seconds=int(data.get("expires_in", 3600)) - 60)
        ).isoformat()
        if data.get("refresh_token"):
            self.tokens["refresh_token"] = data["refresh_token"]
        self.row.secret_encrypted = encrypt(json.dumps(self.tokens))

    def _token(self) -> str:
        expires = self.tokens.get("expires_at")
        if not self.tokens.get("access_token") or not expires or datetime.fromisoformat(expires) <= datetime.now(UTC):
            self._refresh()
        return self.tokens["access_token"]

    def request(self, method: str, url: str, **kwargs) -> httpx.Response:
        for attempt in (1, 2):
            r = self.http.request(method, url, headers={"Authorization": f"Bearer {self._token()}"}, **kwargs)
            if r.status_code == 401 and attempt == 1:
                self.tokens["access_token"] = None
                continue
            return r
        return r

    def json(self, method: str, url: str, ok: tuple[int, ...] = (200,), **kwargs) -> dict:
        r = self.request(method, url, **kwargs)
        if r.status_code == 403 and "insufficient" in r.text.lower():
            raise NeedsReconnect("Faltan permisos: vuelve a conectar Google y acepta todos")
        if r.status_code not in ok:
            raise GoogleError(_google_message(r))
        return r.json() if r.content else {}


# --- Gmail ---------------------------------------------------------------------------

CATEGORY_LABELS = {
    "CATEGORY_PROMOTIONS": "promotions",
    "CATEGORY_SOCIAL": "social",
    "CATEGORY_UPDATES": "updates",
    "CATEGORY_FORUMS": "forums",
}


def gmail_link(thread_id: str, account: str | None) -> str:
    who = f"?authuser={account}" if account else ""
    return f"https://mail.google.com/mail/{who}#inbox/{thread_id}"


def _headers(message: dict) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in message.get("payload", {}).get("headers", [])}


def _apply_thread(email: Email, item: Item, thread: dict) -> None:
    messages = thread.get("messages") or []
    labels = {label for m in messages for label in m.get("labelIds", [])}
    first, last = messages[0], messages[-1]
    received = [m for m in messages if "SENT" not in m.get("labelIds", [])] or messages
    sender_name, sender_email = parseaddr(_headers(received[-1]).get("from", ""))
    subject = _headers(first).get("subject") or _headers(last).get("subject") or "(sin asunto)"

    item.title = subject.strip()[:300] or "(sin asunto)"
    email.history_id = str(thread.get("historyId") or "")
    email.sender_name = sender_name or None
    email.sender_email = sender_email or None
    email.snippet = (last.get("snippet") or "")[:500]
    email.received_at = datetime.fromtimestamp(int(last.get("internalDate", "0")) / 1000, UTC)
    email.unread = "UNREAD" in labels
    email.starred = "STARRED" in labels
    email.important = "IMPORTANT" in labels
    email.category = next((v for k, v in CATEGORY_LABELS.items() if k in labels), "primary")
    email.message_count = len(messages)


def sync_gmail(db: Session, g: Google) -> int:
    """Deja la tabla `emails` igual que la bandeja de entrada (últimos 30 días)."""
    threads: list[dict] = []
    page = None
    while len(threads) < INBOX_MAX:
        params = {"q": INBOX_QUERY, "maxResults": min(100, INBOX_MAX - len(threads))}
        if page:
            params["pageToken"] = page
        data = g.json("GET", f"{GMAIL}/threads", params=params)
        threads += data.get("threads", [])
        page = data.get("nextPageToken")
        if not page:
            break

    existing = {
        e.thread_id: e
        for e in db.scalars(select(Email).options(selectinload(Email.item)))
    }
    seen: set[str] = set()
    for t in threads:
        seen.add(t["id"])
        email = existing.get(t["id"])
        if email is not None and email.history_id == str(t.get("historyId")):
            continue  # sin cambios desde la última vez
        full = g.json("GET", f"{GMAIL}/threads/{t['id']}", params={
            "format": "metadata", "metadataHeaders": ["From", "Subject", "Date"],
        })
        if not full.get("messages"):
            continue
        if email is None:
            item = Item(kind="email", title="", status="ready", tags=[], entities={})
            email = Email(thread_id=t["id"])
            item.email = email
            db.add(item)
        _apply_thread(email, email.item, full)
        db.flush()
        schedule_index(db, email.item_id)

    for thread_id, email in existing.items():
        if thread_id not in seen:
            db.delete(email.item)
    return len(seen)


def _modify_thread(g: Google, thread_id: str, add: list[str] | None = None, remove: list[str] | None = None) -> None:
    g.json("POST", f"{GMAIL}/threads/{thread_id}/modify",
           json={"addLabelIds": add or [], "removeLabelIds": remove or []})


def archive_email(db: Session, email: Email) -> None:
    with Google(db) as g:
        _modify_thread(g, email.thread_id, remove=["INBOX"])
    db.delete(email.item)


def mark_read(db: Session, email: Email, read: bool = True) -> None:
    with Google(db) as g:
        if read:
            _modify_thread(g, email.thread_id, remove=["UNREAD"])
        else:
            _modify_thread(g, email.thread_id, add=["UNREAD"])
    email.unread = not read


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


def _body_text(payload: dict) -> str:
    """El texto de un mensaje: text/plain si lo hay; si no, el HTML sin etiquetas."""
    plain, html = [], []

    def walk(part: dict) -> None:
        mime = part.get("mimeType", "")
        data = (part.get("body") or {}).get("data")
        if data and mime == "text/plain":
            plain.append(_decode(data))
        elif data and mime == "text/html":
            html.append(_decode(data))
        for sub in part.get("parts") or []:
            walk(sub)

    walk(payload)
    if plain:
        text = "\n".join(plain)
    else:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", "\n".join(html), flags=re.S | re.I)
        text = unescape(re.sub(r"<br\s*/?>|</p>|</div>", "\n", text, flags=re.I))
        text = re.sub(r"<[^>]+>", " ", text)
    # Sin las citas del correo anterior («> …» y «El … escribió:»), que repiten el hilo.
    text = re.split(r"\n(?:El .{5,120} escribió:|On .{5,120} wrote:)\s*\n", text)[0]
    lines = [line for line in text.splitlines() if not line.lstrip().startswith(">")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def read_thread(db: Session, email: Email) -> dict:
    """El hilo entero, mensaje a mensaje, para que Jarvis lo lea."""
    row = integration(db)
    with Google(db) as g:
        thread = g.json("GET", f"{GMAIL}/threads/{email.thread_id}", params={"format": "full"})
    messages = []
    for m in thread.get("messages", []):
        h = _headers(m)
        messages.append({
            "de": h.get("from", ""), "para": h.get("to", ""),
            "fecha": datetime.fromtimestamp(int(m.get("internalDate", "0")) / 1000, UTC).isoformat(),
            "texto": _body_text(m.get("payload", {}))[:6000],
        })
    return {"id": str(email.item_id), "asunto": email.item.title, "mensajes": messages[-8:],
            "url": gmail_link(email.thread_id, row.account if row else None)}


def _reply_mime(db: Session, g: "Google", email: Email, body: str) -> tuple[dict, str, str]:
    """El mensaje de respuesta (MIME en base64url) con las cabeceras para que Gmail lo enhebre."""
    thread = g.json("GET", f"{GMAIL}/threads/{email.thread_id}", params={
        "format": "metadata", "metadataHeaders": ["From", "To", "Reply-To", "Subject", "Message-ID", "References"],
    })
    messages = thread.get("messages") or []
    if not messages:
        raise GoogleError("El hilo está vacío")
    received = [m for m in messages if "SENT" not in m.get("labelIds", [])] or messages
    last = _headers(received[-1])
    to = last.get("reply-to") or last.get("from") or ""
    subject = _headers(messages[0]).get("subject") or email.item.title
    if not subject.lower().startswith(("re:", "re :")):
        subject = f"Re: {subject}"
    msg = EmailMessage()
    msg["To"] = to
    me = integration(db).account
    if me:
        msg["From"] = me
    msg["Subject"] = subject
    if last.get("message-id"):
        msg["In-Reply-To"] = last["message-id"]
        msg["References"] = f"{last.get('references', '')} {last['message-id']}".strip()
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    return {"raw": raw, "threadId": email.thread_id}, parseaddr(to)[1] or to, subject


def create_reply_draft(db: Session, email: Email, body: str) -> dict:
    with Google(db) as g:
        message, to, subject = _reply_mime(db, g, email, body)
        data = g.json("POST", f"{GMAIL}/drafts", json={"message": message})
    return {"draft_id": data["id"], "to": to, "subject": subject,
            "url": "https://mail.google.com/mail/#drafts"}


def send_draft(db: Session, draft_id: str, email: Email | None = None, body: str | None = None) -> None:
    """Envía un borrador. Si llega el texto editado, primero se actualiza el borrador."""
    with Google(db) as g:
        if body is not None and email is not None:
            message, _, _ = _reply_mime(db, g, email, body)
            g.json("PUT", f"{GMAIL}/drafts/{draft_id}", json={"id": draft_id, "message": message})
        g.json("POST", f"{GMAIL}/drafts/send", json={"id": draft_id})


# --- Google Calendar -----------------------------------------------------------------

PALETTE = {"cobalt": 212, "teal": 176, "moss": 142, "ochre": 40, "clay": 6, "rose": 338, "plum": 285}


def _nearest_color(hex_color: str | None) -> str:
    try:
        value = (hex_color or "").lstrip("#")
        r, g, b = (int(value[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "cobalt"
    h, _, s = colorsys.rgb_to_hls(r, g, b)
    if s < 0.15:
        return "slate"
    hue = h * 360
    return min(PALETTE, key=lambda k: min(abs(PALETTE[k] - hue), 360 - abs(PALETTE[k] - hue)))


def sync_calendar_list(db: Session, g: Google) -> list[Calendar]:
    data = g.json("GET", f"{GCAL}/users/me/calendarList", params={"maxResults": 250})
    existing = {c.external_id: c for c in db.scalars(select(Calendar).where(Calendar.source == "google"))}
    seen = set()
    for entry in data.get("items", []):
        if entry.get("deleted"):
            continue
        cid = entry["id"]
        seen.add(cid)
        cal = existing.get(cid)
        if cal is None:
            cal = Calendar(
                source="google", external_id=cid, name=entry.get("summaryOverride") or entry.get("summary") or cid,
                color=_nearest_color(entry.get("backgroundColor")),
                # Los calendarios que tienes ocultos en Google empiezan desactivados.
                enabled=bool(entry.get("selected") or entry.get("primary")),
            )
            db.add(cal)
        cal.writable = entry.get("accessRole") in ("owner", "writer")
        cal.primary = bool(entry.get("primary"))
    for cid, cal in existing.items():
        if cid not in seen:
            for item_id in db.scalars(select(Event.item_id).where(Event.calendar_id == cal.id)).all():
                db.delete(db.get(Item, item_id))
            db.delete(cal)
    db.flush()
    return [c for c in db.scalars(select(Calendar).where(Calendar.source == "google"))]


def _parse_when(value: dict) -> tuple[datetime, bool]:
    if "dateTime" in value:
        return datetime.fromisoformat(value["dateTime"].replace("Z", "+00:00")).astimezone(UTC), False
    day = date.fromisoformat(value["date"])
    return datetime.combine(day, time.min, tzinfo=get_settings().tz).astimezone(UTC), True


def _remind_minutes(entry: dict) -> int | None:
    reminders = entry.get("reminders") or {}
    if reminders.get("useDefault", True):
        return None
    popups = [o["minutes"] for o in reminders.get("overrides", []) if o.get("method") == "popup"]
    return min(popups) if popups else None


def _meet_url(entry: dict) -> str | None:
    if entry.get("hangoutLink"):
        return entry["hangoutLink"]
    for point in (entry.get("conferenceData") or {}).get("entryPoints", []):
        if point.get("entryPointType") == "video":
            return point.get("uri")
    return None


def sync_events(db: Session, g: Google, cal: Calendar) -> int:
    """Deja en la base los eventos del calendario en la ventana (pasado y próximo año)."""
    now = datetime.now(UTC)
    params = {
        "singleEvents": "true", "maxResults": 2500, "showDeleted": "false",
        "timeMin": (now - SYNC_PAST).isoformat(), "timeMax": (now + SYNC_FUTURE).isoformat(),
    }
    entries: list[dict] = []
    while True:
        data = g.json("GET", f"{GCAL}/calendars/{_q(cal.external_id)}/events", params=params)
        entries += data.get("items", [])
        if not data.get("nextPageToken"):
            break
        params["pageToken"] = data["nextPageToken"]

    existing = {
        e.external_key: e
        for e in db.scalars(select(Event).options(selectinload(Event.item)).where(Event.calendar_id == cal.id))
    }
    seen: set[str] = set()
    for entry in entries:
        if entry.get("status") == "cancelled" or "start" not in entry:
            continue
        starts_at, all_day = _parse_when(entry["start"])
        ends_at, _ = _parse_when(entry.get("end") or entry["start"])
        if ends_at <= starts_at:
            ends_at = starts_at + (timedelta(days=1) if all_day else timedelta(hours=1))
        key = entry["id"]
        seen.add(key)
        title = (entry.get("summary") or "Sin título")[:300]
        values = {
            "starts_at": starts_at, "ends_at": ends_at, "all_day": all_day,
            "location": entry.get("location") or None,
            "description": (entry.get("description") or "")[:5000] or None,
            "url": entry.get("htmlLink"), "meet_url": _meet_url(entry),
            "remind_minutes": _remind_minutes(entry),
        }
        entities: dict = {}
        if entry.get("recurringEventId"):
            entities["recurring_event_id"] = entry["recurringEventId"]
        # Con quién es (para recordarte su ficha antes de la reunión). Tú no cuentas.
        attendees = [{"email": a.get("email", ""), "name": a.get("displayName", "")}
                     for a in entry.get("attendees") or [] if not a.get("self") and not a.get("resource")]
        if attendees:
            entities["attendees"] = attendees[:30]
        event = existing.get(key)
        if event is None:
            item = Item(kind="event", title=title, status="ready", tags=[], entities={})
            event = Event(calendar_id=cal.id, external_key=key)
            item.event = event
            db.add(item)
        else:
            item = event.item
            if (item.title == title and (item.entities or {}) == entities
                    and all(getattr(event, k) == v for k, v in values.items()) and not event.rrule):
                continue
        item.title = title
        item.entities = entities
        event.rrule = None
        event.repeat_until = None
        for k, v in values.items():
            setattr(event, k, v)
        db.flush()
        schedule_index(db, item.id)

    for key, event in existing.items():
        if key not in seen:
            db.delete(event.item)
    cal.last_synced_at = now
    cal.sync_error = None
    return len(seen)


def _q(calendar_id: str | None) -> str:
    return quote(calendar_id or "primary", safe="")


def _event_body(item: Item, event: Event) -> dict:
    tz = get_settings().tz
    if event.all_day:
        start = {"date": event.starts_at.astimezone(tz).date().isoformat()}
        end = {"date": event.ends_at.astimezone(tz).date().isoformat()}
    else:
        start = {"dateTime": event.starts_at.astimezone(tz).isoformat(), "timeZone": get_settings().timezone}
        end = {"dateTime": event.ends_at.astimezone(tz).isoformat(), "timeZone": get_settings().timezone}
    body = {
        "summary": item.title, "start": start, "end": end,
        "location": event.location or "", "description": event.description or "",
        "reminders": {"useDefault": True} if event.remind_minutes is None else {
            "useDefault": False, "overrides": [{"method": "popup", "minutes": event.remind_minutes}],
        },
    }
    if event.rrule and not (item.entities or {}).get("recurring_event_id"):
        body["recurrence"] = [f"RRULE:{event.rrule}"]
    return body


def push_event(db: Session, item: Item) -> None:
    """Crea o actualiza el evento en Google. Se llama antes de confirmar el cambio local."""
    event = item.event
    cal = event.calendar or db.get(Calendar, event.calendar_id)
    if not cal.writable:
        raise GoogleError("No tienes permiso para editar este calendario de Google")
    with Google(db) as g:
        if event.external_key:
            data = g.json("PATCH", f"{GCAL}/calendars/{_q(cal.external_id)}/events/{_q(event.external_key)}",
                          json=_event_body(item, event))
        else:
            data = g.json("POST", f"{GCAL}/calendars/{_q(cal.external_id)}/events", json=_event_body(item, event))
    event.external_key = data["id"]
    event.url = data.get("htmlLink")
    event.meet_url = _meet_url(data)
    if event.rrule:
        # Google expande la repetición; la próxima sincronización trae cada ocurrencia.
        enqueue(db, "sync_google_calendar", {"calendar_id": str(cal.id)}, dedupe=True, max_attempts=1)


def delete_remote_event(db: Session, item: Item) -> None:
    event = item.event
    if not event.external_key:
        return
    cal = event.calendar
    if not cal.writable:
        raise GoogleError("No tienes permiso para editar este calendario de Google")
    with Google(db) as g:
        r = g.request("DELETE", f"{GCAL}/calendars/{_q(cal.external_id)}/events/{_q(event.external_key)}")
        if r.status_code not in (200, 204, 404, 410):
            raise GoogleError(_google_message(r))


# --- Trabajos y planificación ------------------------------------------------------------

def _mark(db: Session, part: str, error: Exception | None) -> None:
    row = integration(db)
    if row is None:
        return
    state = dict(row.state or {})
    state[f"{part}_synced_at"] = datetime.now(UTC).isoformat()
    if error is None:
        state.pop(f"{part}_error", None)
    else:
        state[f"{part}_error"] = str(error)[:300]
    row.state = state
    if isinstance(error, NeedsReconnect):
        row.status = "reconnect"
        row.error = str(error)[:300]
    elif error is None and row.status == "reconnect":
        row.status, row.error = "ok", None


def _run(db: Session, part: str, fn) -> None:
    try:
        with Google(db) as g:
            fn(g)
        _mark(db, part, None)
    except (GoogleError, httpx.HTTPError) as exc:
        db.rollback()
        log.warning("Sincronización de Google (%s) fallida: %s", part, exc)
        _mark(db, part, exc)


@handler("sync_gmail")
def _sync_gmail(db: Session, payload: dict) -> None:
    _run(db, "gmail", lambda g: sync_gmail(db, g))


@handler("sync_google_calendar")
def _sync_google_calendar(db: Session, payload: dict) -> None:
    only = payload.get("calendar_id")

    def work(g: Google) -> None:
        calendars = sync_calendar_list(db, g) if not only else [db.get(Calendar, uuid.UUID(only))]
        for cal in calendars:
            if cal is None or not cal.enabled:
                continue
            try:
                count = sync_events(db, g, cal)
                log.info("Google Calendar %s: %d eventos", cal.name, count)
            except GoogleError as exc:
                if isinstance(exc, NeedsReconnect):
                    raise
                cal.sync_error = str(exc)[:300]
                cal.last_synced_at = datetime.now(UTC)

    _run(db, "calendar", work)


def schedule_google_sync(db: Session, now: datetime | None = None, force: bool = False) -> None:
    row = integration(db)
    if row is None or not row.secret_encrypted or row.status == "reconnect":
        return
    settings = get_settings()
    now = now or datetime.now(UTC)
    state = row.state or {}
    for part, kind, minutes in (
        ("gmail", "sync_gmail", settings.gmail_sync_minutes),
        ("calendar", "sync_google_calendar", settings.google_calendar_sync_minutes),
    ):
        last = state.get(f"{part}_synced_at")
        if force or last is None or now - datetime.fromisoformat(last) >= timedelta(minutes=minutes) - timedelta(seconds=5):
            enqueue(db, kind, {}, dedupe=True, max_attempts=1)
