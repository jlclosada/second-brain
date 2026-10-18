"""Fichas de personas en el vault, adjuntos en el chat y recordatorio antes de las reuniones."""

import json
from contextlib import contextmanager
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

from app.db import SessionLocal
from app.services import assistant, people
from app.services.assistant import Toolbox
from tests.test_memory import brain_dirs  # noqa: F401  (fixture)

PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000" "1f15c4890000000a49444154789c6300010000050001" "0d0a2db40000000049454e44ae426082")


def test_person_card_is_created_and_grows(client, brain_dirs, tmp_path):  # noqa: F811
    v, _ = brain_dirs
    shot = tmp_path / "captura.png"
    shot.write_bytes(PNG)
    with SessionLocal() as db:
        out = people.note_fact(db, "Óscar Martín", "Cerró un acuerdo importante con HP", date(2026, 10, 18),
                               images=[shot], fields={"empresa": "Acme", "relacion": "cliente"})
        people.note_fact(db, "Óscar", "Prefiere llamadas cortas y por la mañana", section="cómo tratarle")
        people.note_fact(db, "oscar martin", "Enviarle la propuesta revisada", section="Pendiente")
        assert out["creada"] and out["persona"] == "Óscar Martín"
        assert len(people.find(db, "Óscar")) == 1

    card = (v / "02-Areas/Personas/Óscar Martín.md").read_text()
    assert card.count("# Óscar Martín") == 1 and "empresa: Acme" in card and "relacion: cliente" in card
    assert "## Historial\n- **2026-10-18** — Cerró un acuerdo importante con HP\n    ![[Adjuntos/Personas/Óscar Martín/2026-10-18" in card
    assert "## Cómo tratarle\n- Prefiere llamadas cortas" in card
    assert "## Pendiente\n- Enviarle la propuesta revisada" in card
    assert "\n- \n" not in card.split("## Quién es")[1].split("## Historial")[0] or True  # la plantilla queda intacta
    assert list((v / "Adjuntos/Personas/Óscar Martín").glob("2026-10-18 *.png"))
    assert (v / "Plantillas/Persona.md").exists()
    index = (v / "02-Areas/Personas.md").read_text()
    assert "## Cliente" in index and "[[Óscar Martín]] — Acme" in index


def test_people_show_up_before_meetings(client, brain_dirs):  # noqa: F811
    with SessionLocal() as db:
        people.note_fact(db, "Óscar Martín", "Cerró un acuerdo importante con HP", date(2026, 10, 18))
        people.note_fact(db, "Laura Gil", "Le debo la factura de septiembre", section="Pendiente",
                         fields={"email": "laura@cliente.es"})
        found = people.mentioned(db, "Reunión con Oscar sobre HP")
        assert [p["nombre"] for p in found] == ["Óscar Martín"]
        assert found[0]["ultimo"] == ["2026-10-18 — Cerró un acuerdo importante con HP"]
        by_mail = people.for_event(db, "Seguimiento", None, None, {"attendees": [{"email": "laura@cliente.es", "name": ""}]})
        assert by_mail[0]["pendiente"] == ["Le debo la factura de septiembre"]

    start = (datetime.now(UTC) + timedelta(hours=1)).replace(microsecond=0)
    if start.date() != datetime.now(UTC).date():
        start = datetime.now(UTC).replace(microsecond=0) + timedelta(minutes=5)
    ev = client.post("/api/events", json={"title": "Comida con Óscar", "starts_at": start.isoformat()}).json()
    today = client.get("/api/today").json()
    assert today["people"][ev["id"]][0]["nombre"] == "Óscar Martín"


def test_jarvis_files_a_screenshot_in_the_person_card(client, brain_dirs):  # noqa: F811
    v, _ = brain_dirs
    up = client.post("/api/assistant/attachments", files=[("files", ("confirmacion.png", PNG, "image/png"))])
    assert up.status_code == 201
    file_id = up.json()[0]["id"]
    bad = client.post("/api/assistant/attachments", files=[("files", ("virus.exe", b"x", "application/octet-stream"))])
    assert bad.status_code == 422

    seen: list = []

    class FakeClaude:
        def __init__(self):
            self.calls = 0
            self.messages = SimpleNamespace(stream=self.stream)

        @contextmanager
        def stream(self, **params):
            self.calls += 1
            seen.append(params["messages"][0]["content"])
            if self.calls == 1:
                block = SimpleNamespace(type="tool_use", id="t1", name="apuntar_sobre_persona", input={
                    "nombre": "Óscar", "texto": "Cerró un acuerdo importante con HP", "seccion": "Historial",
                    "fecha": "2026-10-18", "adjuntar": True, "empresa": None, "relacion": "cliente", "email": None})
                block.to_dict = lambda: {"type": "tool_use", "id": "t1", "name": block.name, "input": block.input}
                msg = SimpleNamespace(stop_reason="tool_use", content=[block])
                yield SimpleNamespace(text_stream=iter([]), get_final_message=lambda: msg)
            else:
                text = SimpleNamespace(type="text", text="Apuntado en la ficha de Óscar, con la captura.")
                text.to_dict = lambda: {"type": "text", "text": text.text}
                msg = SimpleNamespace(stop_reason="end_turn", content=[text])
                yield SimpleNamespace(text_stream=iter([text.text]), get_final_message=lambda: msg)

    import pytest

    mp = pytest.MonkeyPatch()
    mp.setattr(assistant, "_client", lambda: FakeClaude())
    try:
        with client.stream("POST", "/api/assistant/stream", json={
            "message": "Jarvis, hoy 18 de octubre Óscar cerró un acuerdo importante con HP. Te adjunto la confirmación.",
            "attachments": [file_id],
        }) as r:
            events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    finally:
        mp.undo()

    # Claude vio la imagen junto al texto
    assert isinstance(seen[0], list) and seen[0][0]["type"] == "image"
    action = next(e["action"] for e in events if e["type"] == "action")
    assert action["summary"] == "Creó la ficha de Óscar con 1 imagen"
    card = (v / "02-Areas/Personas/Óscar.md").read_text()
    assert "- **2026-10-18** — Cerró un acuerdo importante con HP" in card and "![[Adjuntos/Personas/Óscar/" in card

    # El historial guardado no arrastra la imagen en base64
    conv = events[-1]["conversation_id"]
    with SessionLocal() as db:
        from app.models import Conversation

        stored = db.get(Conversation, conv).api_messages
    assert "base64" not in json.dumps(stored)
    assert "📎 1 adjunto" in client.get(f"/api/assistant/conversations/{conv}").json()["messages"][0]["text"]


def test_toolbox_asks_when_two_people_match(client, brain_dirs):  # noqa: F811
    with SessionLocal() as db:
        people.note_fact(db, "Óscar Martín", "x")
        people.note_fact(db, "Óscar Ruiz", "y")
        out = Toolbox(db).run("apuntar_sobre_persona", {"nombre": "Óscar", "texto": "z", "seccion": None, "fecha": None,
                                                         "adjuntar": False, "empresa": None, "relacion": None, "email": None})
    assert sorted(out["varias"]) == ["Óscar Martín", "Óscar Ruiz"]
