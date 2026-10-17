"""Seguridad: contraseña con Argon2, segundo factor TOTP, sesiones revocables,
límite de intentos, cifrado de secretos y registro de actividad."""

import base64
import hashlib
import ipaddress
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pyotp
import segno
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import Account, AuditLog, LoginAttempt, UserSession

COOKIE_NAME = "sb_session"
# Cabecera obligatoria en peticiones que cambian datos. Un formulario o un
# <img> de otra web no puede añadirla, así que bloquea ataques CSRF.
CSRF_HEADER = "x-requested-with"
TOTP_ISSUER = "Segundo Cerebro"
_SEEN_EVERY = timedelta(minutes=5)

_hasher = PasswordHasher()


# --- Cifrado de secretos guardados (URLs iCal, semilla TOTP) ----------------

def _fernet() -> Fernet:
    digest = hashlib.sha256(("sb-encryption:" + get_settings().signing_key()).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt(value: str) -> bytes:
    return _fernet().encrypt(value.encode())


def decrypt(value: bytes | None) -> str | None:
    if not value:
        return None
    try:
        return _fernet().decrypt(value).decode()
    except InvalidToken:
        return None


# --- Cuenta -------------------------------------------------------------------

def get_account(db: Session) -> Account:
    """La cuenta del dueño. La primera vez se crea con APP_PASSWORD."""
    account = db.get(Account, 1)
    if account is None:
        account = Account(
            id=1,
            password_hash=_hasher.hash(get_settings().app_password),
            feed_token=secrets.token_urlsafe(32),
            prefs={},
        )
        db.add(account)
        db.commit()
    return account


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(account: Account, password: str) -> bool:
    try:
        return _hasher.verify(account.password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def check_password_strength(password: str) -> None:
    if len(password) < 12:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "La contraseña debe tener al menos 12 caracteres")


# --- Segundo factor (TOTP) --------------------------------------------------

def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name="dueño", issuer_name=TOTP_ISSUER)


def totp_qr_svg(uri: str) -> str:
    return segno.make(uri, error="m").svg_inline(scale=5, dark="#18212f", light="#ffffff")


def verify_totp(secret: str | None, code: str | None) -> bool:
    if not secret or not code:
        return False
    return pyotp.TOTP(secret).verify(code.replace(" ", ""), valid_window=1)


# --- Límite de intentos -----------------------------------------------------

def client_ip(request: Request) -> str:
    host = request.client.host if request.client else ""
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return "0.0.0.0"


def ensure_not_locked(db: Session, ip: str, settings: Settings) -> None:
    since = datetime.now(UTC) - timedelta(minutes=settings.login_window_minutes)
    failures = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.ip == ip, LoginAttempt.at >= since, LoginAttempt.success.is_(False)
        )
    ) or 0
    # Además del límite por IP, uno global por si el ataque viene de muchas.
    global_failures = db.scalar(
        select(func.count()).select_from(LoginAttempt).where(
            LoginAttempt.at >= since, LoginAttempt.success.is_(False)
        )
    ) or 0
    if failures >= settings.login_max_failures or global_failures >= settings.login_max_failures * 10:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Demasiados intentos fallidos. Espera {settings.login_window_minutes} minutos.",
        )


def record_attempt(db: Session, ip: str, success: bool) -> None:
    db.add(LoginAttempt(ip=ip, success=success))
    db.commit()


# --- Sesiones ---------------------------------------------------------------

def create_session(db: Session, request: Request, settings: Settings) -> str:
    session = UserSession(
        expires_at=datetime.now(UTC) + timedelta(days=settings.session_days),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(session)
    db.commit()
    payload = {"sid": str(session.id), "exp": session.expires_at}
    return jwt.encode(payload, settings.signing_key(), algorithm="HS256")


def cookie_secure(request: Request, settings: Settings) -> bool:
    if settings.cookie_secure is not None:
        return settings.cookie_secure
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def _token_session_id(token: str, settings: Settings) -> uuid.UUID:
    try:
        payload = jwt.decode(token, settings.signing_key(), algorithms=["HS256"])
        return uuid.UUID(payload["sid"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión caducada") from None


def current_session(
    request: Request,
    session_cookie: str | None = Cookie(default=None, alias=COOKIE_NAME),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> UserSession:
    token = session_cookie
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Inicia sesión")
    session = db.get(UserSession, _token_session_id(token, settings))
    now = datetime.now(UTC)
    if session is None or session.revoked_at or session.expires_at <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión caducada")
    if now - session.last_seen_at > _SEEN_EVERY:
        session.last_seen_at = now
        db.commit()
    request.state.session_id = session.id
    return session


def require_user(session: UserSession = Depends(current_session)) -> str:
    return "owner"


# --- Registro de actividad --------------------------------------------------

def audit(db: Session, action: str, request: Request | None = None, **detail) -> None:
    db.add(AuditLog(action=action, ip=client_ip(request) if request else None, detail=detail))
    db.commit()
