from alembic import context
from sqlalchemy import engine_from_config, pool

import app.models  # noqa: F401  registra las tablas
from app.db import Base

config = context.config
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    # Índices creados a mano en SQL (GIN, HNSW) que el autogenerate no entiende.
    return not (type_ == "index" and name in {"chunks_tsv_idx", "chunks_embedding_idx", "jobs_queue_idx"})


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, include_object=include_object)
        with context.begin_transaction():
            # Si arrancan app y worker a la vez, solo uno migra.
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(727274)")
            context.run_migrations()


run_migrations_online()
