"""Notas del vault de Obsidian, indexadas para buscar y para el asistente.

El vault es la fuente de verdad: aquí solo se guarda una copia para buscar
(texto, frontmatter, fecha de modificación). Si cambia en disco, se reindexa."""

import uuid

from sqlalchemy import Float, ForeignKey, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class VaultNote(Base):
    __tablename__ = "vault_notes"

    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), primary_key=True
    )
    # Ruta relativa al vault, p. ej. "01-Proyectos/Verifactu API/Modelo de negocio.md"
    path: Mapped[str] = mapped_column(Text, unique=True)
    folder: Mapped[str] = mapped_column(Text, default="", index=True)
    mtime: Mapped[float] = mapped_column(Float, default=0)
    frontmatter: Mapped[dict] = mapped_column(JSONB, default=dict)
    body: Mapped[str] = mapped_column(Text, default="")

    item = relationship("Item", back_populates="vault_note")
