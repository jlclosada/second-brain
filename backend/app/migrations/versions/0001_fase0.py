"""Esquema de la fase 0: documentos, fragmentos y búsqueda.

Las instalaciones de la fase 0 crearon estas tablas sin Alembic; si ya
existen, la migración no hace nada y solo queda registrada.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql as pg

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# unaccent() no es IMMUTABLE, así que no puede usarse en una columna generada.
# Este envoltorio sí lo es y permite buscar "poliza" y encontrar "póliza".
PREPARE_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
"""


def upgrade() -> None:
    op.execute(PREPARE_SQL)
    if sa.inspect(op.get_bind()).has_table("items"):
        return

    op.create_table(
        "items",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("summary", sa.Text),
        sa.Column("category", sa.String(40)),
        sa.Column("doc_type", sa.String(80)),
        sa.Column("doc_date", sa.Date),
        sa.Column("expires_on", sa.Date),
        sa.Column("year", sa.Integer),
        sa.Column("tags", pg.ARRAY(sa.Text), nullable=False),
        sa.Column("entities", pg.JSONB, nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_items_kind", "items", ["kind"])
    op.create_index("ix_items_category", "items", ["category"])
    op.create_index("ix_items_year", "items", ["year"])
    op.create_index("ix_items_status", "items", ["status"])

    op.create_table(
        "documents",
        sa.Column("item_id", pg.UUID(as_uuid=True), sa.ForeignKey("items.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("mime", sa.String(120), nullable=False),
        sa.Column("size", sa.BigInteger, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False, unique=True),
        sa.Column("path", sa.Text, nullable=False),
        sa.Column("text", sa.Text),
        sa.Column("pages", sa.Integer),
        sa.Column("ocr_used", sa.Boolean, nullable=False),
    )

    op.create_table(
        "chunks",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("item_id", pg.UUID(as_uuid=True), sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ord", sa.Integer, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("embedding", Vector(384)),
        sa.Column(
            "tsv",
            pg.TSVECTOR,
            sa.Computed("to_tsvector('spanish', immutable_unaccent(content))", persisted=True),
        ),
    )
    op.create_index("ix_chunks_item_id", "chunks", ["item_id"])
    op.execute("CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv)")
    op.execute("CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops)")


def downgrade() -> None:
    op.drop_table("chunks")
    op.drop_table("documents")
    op.drop_table("items")
