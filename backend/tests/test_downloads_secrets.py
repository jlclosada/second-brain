import os
import time

from app.services.downloads import candidates, looks_secret


def _old(path):
    past = time.time() - 3600
    os.utime(path, (past, past))
    return path


def test_private_keys_are_never_picked_up(tmp_path):
    key = tmp_path / "ssh-key-2026-11-17.key"
    key.write_text("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n")
    _old(key)
    openssh = tmp_path / "id.txt"
    openssh.write_text("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n")
    _old(openssh)
    doc = tmp_path / "factura.pdf"
    doc.write_bytes(b"%PDF-1.4 hola")
    _old(doc)

    assert looks_secret(key) and looks_secret(openssh) and not looks_secret(doc)
    assert candidates(tmp_path, settle_seconds=60) == [doc]
