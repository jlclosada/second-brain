"""Acceso de un único usuario: contraseña → cookie de sesión firmada (JWT)."""

import hmac
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, status

from app.config import Settings, get_settings

COOKIE_NAME = "sb_session"


def check_password(password: str, settings: Settings) -> bool:
    return hmac.compare_digest(password.encode(), settings.app_password.encode())


def create_token(settings: Settings) -> str:
    payload = {"sub": "owner", "exp": datetime.now(UTC) + timedelta(days=settings.session_days)}
    return jwt.encode(payload, settings.signing_key(), algorithm="HS256")


def require_user(
    session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> str:
    token = session
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:]
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Inicia sesión")
    try:
        payload = jwt.decode(token, settings.signing_key(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión caducada") from None
    return payload["sub"]
