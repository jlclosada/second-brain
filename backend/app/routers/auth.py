import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.auth import COOKIE_NAME, check_password, create_token, require_user
from app.config import Settings, get_settings
from app.schemas import LoginRequest

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response, settings: Settings = Depends(get_settings)):
    if not check_password(body.password, settings):
        time.sleep(1)  # frena los intentos por fuerza bruta
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Contraseña incorrecta")
    response.set_cookie(
        COOKIE_NAME,
        create_token(settings),
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
def me(user: str = Depends(require_user)):
    return {"user": user}
