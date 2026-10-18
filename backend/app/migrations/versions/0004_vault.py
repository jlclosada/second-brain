"""Vault de Obsidian como memoria.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('vault_notes',
    sa.Column('item_id', sa.UUID(), nullable=False),
    sa.Column('path', sa.Text(), nullable=False),
    sa.Column('folder', sa.Text(), nullable=False),
    sa.Column('mtime', sa.Float(), nullable=False),
    sa.Column('frontmatter', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id'),
    sa.UniqueConstraint('path')
    )
    op.create_index(op.f('ix_vault_notes_folder'), 'vault_notes', ['folder'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_vault_notes_folder'), table_name='vault_notes')
    op.drop_table('vault_notes')
