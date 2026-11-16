"""La sección Personas: fichas, apuntes con fecha, pendientes, calendario y búsqueda."""

from datetime import UTC, datetime, timedelta

from app.services import people
from tests.test_memory import brain_dirs  # noqa: F401  (fixture)


def _create(client, **body):
    r = client.post("/api/people", json={"name": "Samuel Ortega", "company": "Acme", "relation": "cliente", **body})
    assert r.status_code == 201, r.text
    return r.json()


def test_register_a_person_and_note_what_happened(client, brain_dirs):  # noqa: F811
    v, _ = brain_dirs
    person = _create(client, about="Director comercial de Acme")
    pid = person["id"]
    assert person["company"] == "Acme" and person["about"][0]["text"] == "Director comercial de Acme"

    # Nueva entrada sin fecha: hoy.
    r = client.post(f"/api/people/{pid}/entries", json={"text": "Samuel ha conseguido un ascenso"})
    assert r.status_code == 201, r.text
    entry = r.json()["history"][0]
    assert entry["date"] == people.today().isoformat() and entry["text"] == "Samuel ha conseguido un ascenso"

    # Una con fecha pasada, otra en «Cómo tratarle» y un pendiente.
    client.post(f"/api/people/{pid}/entries", json={"text": "Comida en Madrid", "date": "2026-03-02"})
    client.post(f"/api/people/{pid}/entries", json={"text": "Prefiere\nque vayas al grano", "section": "Cómo tratarle"})
    d = client.post(f"/api/people/{pid}/entries", json={"text": "Enviarle la oferta", "section": "Pendiente"}).json()
    assert [e["date"] for e in d["history"]] == [people.today().isoformat(), "2026-03-02"]
    assert d["how_to"][0]["text"] == "Prefiere que vayas al grano"  # una sola línea: no rompe el Markdown

    text = (v / "02-Areas/Personas/Samuel Ortega.md").read_text()
    assert f"- **{people.today().isoformat()}** — Samuel ha conseguido un ascenso" in text
    assert "empresa: Acme" in text and "relacion: cliente" in text

    # Completar el pendiente lo pasa al historial.
    d = client.post(f"/api/people/{pid}/entries/{d['todo'][0]['id']}/done").json()
    assert d["todo"] == [] and d["history"][0]["text"] == "Hecho: Enviarle la oferta"

    # Editar y borrar apuntes.
    old = next(e for e in d["history"] if e["text"] == "Comida en Madrid")
    d = client.patch(f"/api/people/{pid}/entries/{old['id']}", json={"text": "Comida en Madrid con su equipo"}).json()
    edited = next(e for e in d["history"] if e["date"] == "2026-03-02")
    assert edited["text"] == "Comida en Madrid con su equipo"
    # El id viejo ya no vale: si la ficha cambió (aquí o en Obsidian) no se pisa nada.
    assert client.delete(f"/api/people/{pid}/entries/{old['id']}").status_code == 409
    d = client.delete(f"/api/people/{pid}/entries/{edited['id']}").json()
    assert all(e["date"] != "2026-03-02" for e in d["history"])

    # Datos de la ficha (sí se sobrescriben desde aquí).
    d = client.patch(f"/api/people/{pid}", json={"role": "Director general", "company": "Acme Iberia",
                                                  "email": "samuel@acme.es", "aliases": ["Samu"]}).json()
    assert d["role"] == "Director general" and d["company"] == "Acme Iberia" and d["aliases"] == ["Samu"]
    assert client.patch(f"/api/people/{pid}", json={"email": "no-es-un-correo"}).status_code == 422

    listing = client.get("/api/people").json()
    assert listing["vault"] and listing["people"][0]["last_entry"]["text"] == "Hecho: Enviarle la oferta"

    # Duplicado: devuelve la existente; por alias también.
    r = client.post("/api/people", json={"name": "samu"})
    assert r.status_code == 409 and r.json()["detail"]["id"] == pid


def test_person_links_calendar_and_search(client, brain_dirs, process_all):  # noqa: F811
    pid = _create(client)["id"]
    client.post(f"/api/people/{pid}/entries", json={"text": "Ha conseguido un ascenso a director"})
    start = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    client.post("/api/events", json={"title": "Reunión con Samuel", "starts_at": start.isoformat()})
    client.post("/api/events", json={"title": "Café con Samuel",
                                     "starts_at": (start - timedelta(days=10)).isoformat()})
    v, _ = brain_dirs
    (v / "05-Diario/2026-11-10.md").write_text("# Lunes\n\n- Comida con Samuel: contento con el nuevo puesto\n")
    client.post("/api/memory/sync")
    process_all()
    d = client.get(f"/api/people/{pid}").json()
    assert [m["title"] for m in d["mentions"]] == ["2026-11-10"]
    assert [e["title"] for e in d["upcoming"]] == ["Reunión con Samuel"]
    assert [e["title"] for e in d["past_meetings"]] == ["Café con Samuel"]

    process_all()  # indexa la ficha
    hits = client.get("/api/search", params={"q": "ascenso"}).json()["hits"]
    assert any(h["item"]["id"] == pid and h["item"]["category"] == "persona" for h in hits)


def test_person_routes_are_private_and_scoped(client, brain_dirs):  # noqa: F811
    pid = _create(client)["id"]
    # Una nota del vault que no es una persona no se puede tocar por aquí.
    other = client.get("/api/memory/tree").json()
    note_id = next(n["id"] for f in other for n in f["notes"] if not n["path"].startswith("02-Areas/Personas/"))
    assert client.get(f"/api/people/{note_id}").status_code == 404
    assert client.post(f"/api/people/{note_id}/entries", json={"text": "x"}).status_code == 404
    # Sin la cabecera CSRF no se escribe; sin sesión no se lee.
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as anon:
        assert anon.get(f"/api/people/{pid}").status_code == 401
    r = client.post(f"/api/people/{pid}/entries", json={"text": "x"}, headers={"X-Requested-With": ""})
    assert r.status_code in (401, 403)
    # Nombres con rutas no salen del vault.
    r = client.post("/api/people", json={"name": "../../etc/passwd"})
    assert r.status_code == 201 and r.json()["path"].startswith("02-Areas/Personas/")


def test_brief_without_claude_key(client, brain_dirs):  # noqa: F811
    pid = _create(client)["id"]
    r = client.post(f"/api/people/{pid}/brief")
    assert r.status_code == 200 and r.json() == {"ai": False, "markdown": None}
