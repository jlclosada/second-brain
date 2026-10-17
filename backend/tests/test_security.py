import pyotp
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.main import app
from app.models import Account

CSRF = {"X-Requested-With": "segundo-cerebro"}


def test_mutations_need_csrf_header(client):
    with TestClient(app) as bare:
        bare.cookies = client.cookies
        r = bare.post("/api/tasks", json={"title": "x"})
        assert r.status_code == 403
        assert bare.get("/api/tasks").status_code == 200


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.json() == {"ok": True}
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"


def test_password_is_hashed_and_login_locks_after_failures():
    with SessionLocal() as db:
        from app.security import get_account

        assert get_account(db).password_hash.startswith("$argon2")
    with TestClient(app, headers=CSRF) as c:
        for _ in range(5):
            assert c.post("/api/auth/login", json={"password": "mal"}).status_code == 401
        r = c.post("/api/auth/login", json={"password": "secreto"})
        assert r.status_code == 429


def test_logout_revokes_session(client):
    token = client.cookies.get("sb_session")
    assert client.post("/api/auth/logout").status_code == 200
    with TestClient(app, headers=CSRF) as other:
        other.cookies.set("sb_session", token)
        assert other.get("/api/auth/me").status_code == 401


def test_sessions_can_be_listed_and_revoked(client):
    with TestClient(app, headers=CSRF) as phone:
        assert phone.post("/api/auth/login", json={"password": "secreto"}).status_code == 200
        sessions = client.get("/api/auth/sessions").json()
        assert len(sessions) == 2
        other = next(s for s in sessions if not s["current"])
        assert client.delete(f"/api/auth/sessions/{other['id']}").status_code == 204
        assert phone.get("/api/auth/me").status_code == 401


def test_change_password(client):
    assert client.post("/api/auth/password", json={"current": "mal", "new": "x" * 12}).status_code == 403
    assert client.post("/api/auth/password", json={"current": "secreto", "new": "corta"}).status_code == 422
    assert client.post("/api/auth/password", json={"current": "secreto", "new": "una-contraseña-larga"}).status_code == 200
    with TestClient(app, headers=CSRF) as c:
        assert c.post("/api/auth/login", json={"password": "secreto"}).status_code == 401
        assert c.post("/api/auth/login", json={"password": "una-contraseña-larga"}).status_code == 200
    actions = [a["action"] for a in client.get("/api/auth/audit").json()]
    assert "password_changed" in actions


def test_totp_two_factor(client):
    setup = client.post("/api/auth/totp/setup").json()
    assert "<svg" in setup["qr_svg"]
    assert client.post("/api/auth/totp/enable", json={"code": "000000"}).status_code == 422
    code = pyotp.TOTP(setup["secret"]).now()
    assert client.post("/api/auth/totp/enable", json={"code": code}).status_code == 200
    with SessionLocal() as db:
        account = db.get(Account, 1)
        assert account.totp_enabled and setup["secret"].encode() not in account.totp_secret_encrypted

    with TestClient(app, headers=CSRF) as c:
        r = c.post("/api/auth/login", json={"password": "secreto"})
        assert r.status_code == 401 and r.json()["detail"] == "totp_required"
        assert c.post("/api/auth/login", json={"password": "secreto", "totp": "123456"}).status_code == 401
        ok = c.post("/api/auth/login", json={"password": "secreto", "totp": pyotp.TOTP(setup["secret"]).now()})
        assert ok.status_code == 200
    assert client.get("/api/auth/me").json()["totp_enabled"] is True
