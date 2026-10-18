"""Vault de Obsidian como memoria y Descargas que se ordena sola."""

import os
import time
from datetime import date

import pytest

from app.config import get_settings
from app.db import SessionLocal
from app.services import downloads, vault

POLIZA = """MAPFRE SEGUROS
Póliza de seguro de automóvil a todo riesgo
Vehículo: Seat León, matrícula 1234 ABC.
Periodo de cobertura: 01/03/2024 a 28/02/2025.
Prima anual: 412,50 euros."""


@pytest.fixture
def brain_dirs(tmp_path, monkeypatch):
    v = tmp_path / "Segundo-Cerebro"
    for folder in ("00-Bandeja", "01-Proyectos/Verifactu API", "05-Diario", "Plantillas", ".obsidian"):
        (v / folder).mkdir(parents=True)
    (v / "Plantillas/Nota diaria.md").write_text(
        "---\ntags: [diario]\nfecha: {{date:YYYY-MM-DD}}\nestado: activo\n---\n"
        "# {{date:dddd, D [de] MMMM [de] YYYY}}\n\n## Foco del día\n- [ ] \n\n## Notas y capturas\n- \n\n## Hecho hoy\n- \n\n"
        "---\nEnlaces: [[Inicio]]\n"
    )
    (v / "01-Proyectos/Verifactu API/Modelo de negocio.md").write_text(
        "---\ntags: [proyecto]\nfecha: 2026-10-13\nestado: activo\n---\n# Modelo de negocio\n\n"
        "Cobrar por factura emitida a las gestorías. Ver [[Prospectos]].\n"
    )
    (v / ".obsidian/app.json").write_text("{}")
    dl = tmp_path / "Downloads"
    dl.mkdir()
    settings = get_settings()
    monkeypatch.setattr(settings, "vault_dir", v)
    monkeypatch.setattr(settings, "downloads_dir", dl)
    monkeypatch.setattr(settings, "downloads_settle_seconds", 0)
    monkeypatch.setattr(settings, "downloads_require_ai", False)
    return v, dl


def test_vault_is_indexed_and_searchable(client, brain_dirs, process_all):
    with SessionLocal() as db:
        stats = vault.sync(db)
    assert stats["total"] == 1  # las plantillas y .obsidian no cuentan
    process_all()

    hits = client.get("/api/search", params={"q": "gestorías factura"}).json()["hits"]
    assert hits and hits[0]["item"]["kind"] == "vault"

    tree = client.get("/api/memory/tree").json()
    assert tree[0]["folder"] == "01-Proyectos"
    note = client.get("/api/memory/note", params={"path": "01-Proyectos/Verifactu API/Modelo de negocio.md"}).json()
    assert note["frontmatter"]["estado"] == "activo"
    assert note["obsidian_url"].startswith("obsidian://open?vault=Segundo-Cerebro")

    # Editado en Obsidian → se reindexa; borrado → desaparece
    path = brain_dirs[0] / "01-Proyectos/Verifactu API/Modelo de negocio.md"
    path.write_text(path.read_text() + "\nSuscripción mensual de 29 euros.\n")
    os.utime(path, (time.time() + 5, time.time() + 5))
    with SessionLocal() as db:
        assert vault.sync(db)["changed"] == 1
    path.unlink()
    with SessionLocal() as db:
        assert vault.sync(db)["removed"] == 1


def test_capture_and_daily_follow_vault_rules(client, brain_dirs):
    v, _ = brain_dirs
    r = client.post("/api/memory/capture", json={"text": "Idea: plantilla de factura para autónomos"})
    assert r.status_code == 201
    created = v / r.json()["path"]
    text = created.read_text()
    assert created.parent.name == "00-Bandeja"
    assert "estado: bandeja" in text and "[[Bandeja]]" in text

    # Nunca se sobrescribe: mismo título → «(2)»
    again = client.post("/api/memory/capture", json={"text": "Idea: plantilla de factura para autónomos"}).json()
    assert again["path"].endswith("(2).md")

    with SessionLocal() as db:
        rel = vault.append_daily(db, "Llamar a la gestoría Ruiz", "Notas y capturas", date(2026, 10, 18))
        vault.append_daily(db, "Terminar la demo", "Hecho hoy", date(2026, 10, 18))
    daily = (v / rel).read_text()
    assert rel == "05-Diario/2026-10-18.md"
    assert "# domingo, 18 de octubre de 2026" in daily
    assert "## Notas y capturas\n- Llamar a la gestoría Ruiz" in daily
    assert "## Hecho hoy\n- Terminar la demo" in daily

    # Una nota capturada desde la captura rápida también va al vault
    r = client.post("/api/capture", json={"text": "nota: el código del trastero es 4512"}).json()
    assert r["kind"] == "note"
    assert any("trastero" in p.read_text() for p in (v / "00-Bandeja").glob("*.md"))


def test_downloads_are_classified_renamed_and_filed(client, brain_dirs, process_all):
    v, dl = brain_dirs
    (dl / "scan_0032.txt").write_text(POLIZA)
    (dl / "instalador.pkg").write_bytes(b"x")
    (dl / "a-medias.pdf.crdownload").write_bytes(b"x")

    with SessionLocal() as db:
        assert downloads.scan(db) == 1
    process_all()

    # Ya no está en Descargas: está en el vault, con nombre claro y en su categoría
    assert not (dl / "scan_0032.txt").exists()
    assert (dl / "instalador.pkg").exists() and (dl / "a-medias.pdf.crdownload").exists()
    filed = list((v / "Adjuntos/Vehículo").glob("*.txt"))
    assert len(filed) == 1 and filed[0].name.startswith("2024-03 ")

    notes = list((v / "03-Recursos/Documentos").glob("*.md"))
    assert len(notes) == 1
    note = notes[0].read_text()
    assert "categoria: Vehículo" in note and f"[[Adjuntos/Vehículo/{filed[0].name}" in note and "[[Documentos]]" in note
    index = (v / "03-Recursos/Documentos.md").read_text()
    assert "## Vehículo" in index and f"[[{notes[0].stem}]]" in index

    activity = client.get("/api/activity").json()
    assert activity[0]["title"].startswith("Archivado:")
    status = client.get("/api/memory/status").json()
    assert status["downloads"]["filed"] == 1 and status["vault"]["configured"]

    # El documento sigue abriéndose desde la app
    doc_id = activity[0]["url"].split("/")[-1]
    assert client.get(f"/api/documents/{doc_id}/file").status_code == 200

    # El mismo archivo otra vez: se aparta como duplicado, no se borra
    (dl / "copia.txt").write_text(POLIZA)
    with SessionLocal() as db:
        assert downloads.scan(db) == 0
    assert not (dl / "copia.txt").exists()
    assert (v / "Adjuntos/_Duplicados/copia.txt").exists()


def test_without_vault_downloads_are_left_alone(client, tmp_path, monkeypatch):
    dl = tmp_path / "Downloads"
    dl.mkdir()
    (dl / "factura.txt").write_text("Factura de luz")
    settings = get_settings()
    monkeypatch.setattr(settings, "vault_dir", None)
    monkeypatch.setattr(settings, "downloads_dir", dl)
    with SessionLocal() as db:
        assert downloads.scan(db) == 0
    assert (dl / "factura.txt").exists()


def test_downloads_wait_for_claude_by_default(client, brain_dirs, monkeypatch):
    _, dl = brain_dirs
    monkeypatch.setattr(get_settings(), "downloads_require_ai", True)
    (dl / "scan.txt").write_text(POLIZA)
    with SessionLocal() as db:
        assert downloads.scan(db) == 0
    assert (dl / "scan.txt").exists()
    assert client.get("/api/memory/status").json()["downloads"]["waiting_for_ai"] is True
