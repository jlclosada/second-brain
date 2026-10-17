from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import AuditLog, UserSession
from app.schemas import (
    AuditOut,
    LoginRequest,
    MeOut,
    PasswordChange,
    PrefsUpdate,
    SessionOut,
    TotpCode,
    TotpSetupOut,
)
from app.security import (
    COOKIE_NAME,
    audit,
    check_password_strength,
    client_ip,
    cookie_secure,
    create_session,
    current_session,
    decrypt,
    encrypt,
    ensure_not_locked,
    get_account,
    hash_password,
    new_totp_secret,
    record_attempt,
    totp_qr_svg,
    totp_uri,
    verify_password,
    verify_totp,
)
from app.services.scheduler import DEFAULT_PREFS

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db),
          settings: Settings = Depends(get_settings)):
    ip = client_ip(request)
    ensure_not_locked(db, ip, settings)
    account = get_account(db)
    if not verify_password(account, body.password):
        record_attempt(db, ip, False)
        audit(db, "login_failed", request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Contraseña incorrecta")
    if account.totp_enabled:
        if not body.totp:
            # La contraseña es correcta pero falta el segundo factor: no cuenta como fallo.
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "totp_required")
        if not verify_totp(decrypt(account.totp_secret_encrypted), body.totp):
            record_attempt(db, ip, False)
            audit(db, "login_failed_totp", request)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Código de verificación incorrecto")
    record_attempt(db, ip, True)
    token = create_session(db, request, settings)
    audit(db, "login", request)
    response.set_cookie(
        COOKIE_NAME, token, max_age=settings.session_days * 86400, httponly=True, samesite="lax",
        secure=cookie_secure(request, settings), path="/",
    )
    return {"ok": True}


@router.post("/logout")
def logout(request: Request, response: Response, session: UserSession = Depends(current_session),
           db: Session = Depends(get_db)):
    session = db.merge(session)
    session.revoked_at = datetime.now(UTC)
    db.commit()
    audit(db, "logout", request)
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=MeOut)
def me(session: UserSession = Depends(current_session), db: Session = Depends(get_db),
       settings: Settings = Depends(get_settings)):
    account = get_account(db)
    return MeOut(
        user="owner", totp_enabled=account.totp_enabled, ai_enabled=bool(settings.anthropic_api_key),
        timezone=settings.timezone, session_id=session.id, prefs={**DEFAULT_PREFS, **(account.prefs or {})},
    )


@router.patch("/prefs", response_model=MeOut)
def update_prefs(body: PrefsUpdate, session: UserSession = Depends(current_session), db: Session = Depends(get_db),
                 settings: Settings = Depends(get_settings)):
    account = get_account(db)
    account.prefs = {**(account.prefs or {}), **body.model_dump(exclude_none=True)}
    db.commit()
    return me(session, db, settings)


@router.post("/password")
def change_password(body: PasswordChange, request: Request, session: UserSession = Depends(current_session),
                    db: Session = Depends(get_db)):
    account = get_account(db)
    if not verify_password(account, body.current):
        audit(db, "password_change_failed", request)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La contraseña actual no es correcta")
    check_password_strength(body.new)
    account.password_hash = hash_password(body.new)
    # Cambiar la contraseña cierra todas las demás sesiones.
    db.execute(
        update(UserSession)
        .where(UserSession.id != session.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()
    audit(db, "password_changed", request)
    return {"ok": True}


@router.post("/totp/setup", response_model=TotpSetupOut)
def totp_setup(_: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    account = get_account(db)
    if account.totp_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "La verificación en dos pasos ya está activada")
    secret = new_totp_secret()
    account.totp_secret_encrypted = encrypt(secret)
    db.commit()
    uri = totp_uri(secret)
    return TotpSetupOut(secret=secret, uri=uri, qr_svg=totp_qr_svg(uri))


@router.post("/totp/enable")
def totp_enable(body: TotpCode, request: Request, _: UserSession = Depends(current_session),
                db: Session = Depends(get_db)):
    account = get_account(db)
    if not verify_totp(decrypt(account.totp_secret_encrypted), body.code):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El código no es correcto. Prueba con el siguiente.")
    account.totp_enabled = True
    db.commit()
    audit(db, "totp_enabled", request)
    return {"ok": True}


@router.post("/totp/disable")
def totp_disable(body: TotpCode, request: Request, _: UserSession = Depends(current_session),
                 db: Session = Depends(get_db)):
    account = get_account(db)
    if not body.password or not verify_password(account, body.password):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "La contraseña no es correcta")
    if not verify_totp(decrypt(account.totp_secret_encrypted), body.code):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "El código no es correcto")
    account.totp_enabled = False
    account.totp_secret_encrypted = None
    db.commit()
    audit(db, "totp_disabled", request)
    return {"ok": True}


@router.get("/sessions", response_model=list[SessionOut])
def sessions(session: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.revoked_at.is_(None), UserSession.expires_at > datetime.now(UTC))
        .order_by(UserSession.last_seen_at.desc())
    )
    return [
        SessionOut(id=s.id, created_at=s.created_at, last_seen_at=s.last_seen_at, ip=str(s.ip) if s.ip else None,
                   user_agent=s.user_agent, current=s.id == session.id)
        for s in rows
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: str, request: Request, _: UserSession = Depends(current_session),
                   db: Session = Depends(get_db)):
    target = db.get(UserSession, session_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sesión no encontrada")
    target.revoked_at = datetime.now(UTC)
    db.commit()
    audit(db, "session_revoked", request, session=session_id)


@router.get("/audit", response_model=list[AuditOut])
def audit_log(_: UserSession = Depends(current_session), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditLog).order_by(AuditLog.at.desc()).limit(100))
    return [AuditOut(at=r.at, action=r.action, ip=str(r.ip) if r.ip else None, detail=r.detail) for r in rows]
