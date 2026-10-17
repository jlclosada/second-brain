from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_settings = get_settings()
engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=_settings.db_pool_size,
    max_overflow=_settings.db_pool_size,
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def migrate() -> None:
    """Aplica las migraciones pendientes (alembic upgrade head)."""
    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parent
    cfg = Config()
    cfg.set_main_option("script_location", str(root / "migrations"))
    cfg.set_main_option("sqlalchemy.url", _settings.database_url.replace("%", "%%"))
    command.upgrade(cfg, "head")
