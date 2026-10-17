from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


engine = create_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


# unaccent() no es IMMUTABLE, así que no puede usarse en una columna generada.
# Este envoltorio sí lo es y permite buscar "poliza" y encontrar "póliza".
_PREPARE_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
"""

_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);
"""


def init_db() -> None:
    from app import models  # noqa: F401  registra las tablas

    with engine.begin() as conn:
        conn.execute(text(_PREPARE_SQL))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(_INDEX_SQL))
