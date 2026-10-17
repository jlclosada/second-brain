import uuid
from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.db import Base

CATEGORIES = [
    "Vehículo",
    "Hogar",
    "Salud",
    "Finanzas",
    "Impuestos",
    "Trabajo",
    "Educación",
    "Legal",
    "Viajes",
    "Compras",
    "Personal",
    "Otros",
]

KINDS = ("document", "note", "task", "event")


class Item(Base):
    """Cualquier cosa guardada en el segundo cerebro: documento, nota, tarea o
    evento. Lo común (título, etiquetas, proyecto, búsqueda) vive aquí y lo
    específico de cada tipo en su propia tabla."""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(20), default="document", index=True)
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(40), index=True)
    doc_type: Mapped[str | None] = mapped_column(String(80))
    doc_date: Mapped[date | None] = mapped_column(Date)
    expires_on: Mapped[date | None] = mapped_column(Date, index=True)
    year: Mapped[int | None] = mapped_column(Integer, index=True)
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    entities: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    document: Mapped["Document | None"] = relationship(
        back_populates="item", uselist=False, cascade="all, delete-orphan"
    )
    note: Mapped["Note | None"] = relationship(  # noqa: F821
        back_populates="item", uselist=False, cascade="all, delete-orphan"
    )
    task: Mapped["Task | None"] = relationship(  # noqa: F821
        back_populates="item", uselist=False, cascade="all, delete-orphan", foreign_keys="Task.item_id"
    )
    event: Mapped["Event | None"] = relationship(  # noqa: F821
        back_populates="item", uselist=False, cascade="all, delete-orphan"
    )
    project: Mapped["Project | None"] = relationship()  # noqa: F821
    chunks: Mapped[list["Chunk"]] = relationship(
        back_populates="item", cascade="all, delete-orphan", order_by="Chunk.ord"
    )


class Document(Base):
    __tablename__ = "documents"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    filename: Mapped[str] = mapped_column(Text)
    mime: Mapped[str] = mapped_column(String(120))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    path: Mapped[str] = mapped_column(Text)
    text: Mapped[str | None] = mapped_column(Text)
    pages: Mapped[int | None] = mapped_column(Integer)
    ocr_used: Mapped[bool] = mapped_column(default=False)

    item: Mapped[Item] = relationship(back_populates="document")


class Chunk(Base):
    """Fragmento indexado. El fragmento 0 es la "ficha" (título, tipo,
    categoría, año, etiquetas y resumen) para que los metadatos también
    se encuentren al buscar."""

    __tablename__ = "chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), index=True
    )
    ord: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    embedding = mapped_column(Vector(get_settings().embedding_dim))
    tsv = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('spanish', immutable_unaccent(content))", persisted=True),
    )

    item: Mapped[Item] = relationship(back_populates="chunks")


class ItemLink(Base):
    """Enlace [[así]] desde una nota a otro elemento. Permite ver las referencias inversas."""

    __tablename__ = "item_links"

    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True, index=True
    )
