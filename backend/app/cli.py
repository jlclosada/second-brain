"""Tareas de administración.

    python -m app.cli migrate          aplica las migraciones pendientes
    python -m app.cli reset-password   pone una contraseña nueva (y quita el segundo factor)
"""

import getpass
import sys

from app.db import SessionLocal, migrate


def reset_password() -> None:
    from app.security import check_password_strength, get_account, hash_password

    password = getpass.getpass("Nueva contraseña (mínimo 12 caracteres): ")
    if password != getpass.getpass("Repítela: "):
        sys.exit("No coinciden.")
    check_password_strength(password)
    with SessionLocal() as db:
        account = get_account(db)
        account.password_hash = hash_password(password)
        account.totp_enabled = False
        account.totp_secret_encrypted = None
        db.commit()
    print("Contraseña cambiada. La verificación en dos pasos se ha desactivado.")


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "migrate":
        migrate()
        print("Base de datos al día.")
    elif command == "reset-password":
        reset_password()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
