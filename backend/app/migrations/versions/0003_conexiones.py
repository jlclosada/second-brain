"""Conexiones: Google (Gmail y Calendar) y GitHub.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0003'
down_revision = '0002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('integrations',
    sa.Column('provider', sa.String(length=20), nullable=False),
    sa.Column('client_encrypted', sa.LargeBinary(), nullable=True),
    sa.Column('secret_encrypted', sa.LargeBinary(), nullable=True),
    sa.Column('account', sa.Text(), nullable=True),
    sa.Column('scopes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('state', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('provider')
    )
    op.create_table('emails',
    sa.Column('item_id', sa.UUID(), nullable=False),
    sa.Column('thread_id', sa.String(length=40), nullable=False),
    sa.Column('history_id', sa.String(length=40), nullable=True),
    sa.Column('sender_name', sa.Text(), nullable=True),
    sa.Column('sender_email', sa.Text(), nullable=True),
    sa.Column('snippet', sa.Text(), nullable=False),
    sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('unread', sa.Boolean(), nullable=False),
    sa.Column('starred', sa.Boolean(), nullable=False),
    sa.Column('important', sa.Boolean(), nullable=False),
    sa.Column('category', sa.String(length=20), nullable=False),
    sa.Column('message_count', sa.Integer(), nullable=False),
    sa.Column('task_id', sa.UUID(), nullable=True),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['items.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('item_id'),
    sa.UniqueConstraint('thread_id')
    )
    op.create_index(op.f('ix_emails_received_at'), 'emails', ['received_at'], unique=False)
    op.create_index(op.f('ix_emails_category'), 'emails', ['category'], unique=False)

    op.add_column('tasks', sa.Column('source', sa.String(length=20), nullable=True))
    op.add_column('tasks', sa.Column('external_id', sa.Text(), nullable=True))
    op.add_column('tasks', sa.Column('external_url', sa.Text(), nullable=True))
    op.create_index(op.f('ix_tasks_source'), 'tasks', ['source'], unique=False)
    op.create_index('tasks_external_idx', 'tasks', ['source', 'external_id'], unique=True,
                    postgresql_where=sa.text('external_id IS NOT NULL'))

    op.add_column('calendars', sa.Column('external_id', sa.Text(), nullable=True))
    op.add_column('calendars', sa.Column('writable', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('calendars', sa.Column('primary', sa.Boolean(), server_default='false', nullable=False))

    op.add_column('events', sa.Column('url', sa.Text(), nullable=True))
    op.add_column('events', sa.Column('meet_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('events', 'meet_url')
    op.drop_column('events', 'url')
    op.drop_column('calendars', 'primary')
    op.drop_column('calendars', 'writable')
    op.drop_column('calendars', 'external_id')
    op.drop_index('tasks_external_idx', table_name='tasks')
    op.drop_index(op.f('ix_tasks_source'), table_name='tasks')
    op.drop_column('tasks', 'external_url')
    op.drop_column('tasks', 'external_id')
    op.drop_column('tasks', 'source')
    op.drop_index(op.f('ix_emails_category'), table_name='emails')
    op.drop_index(op.f('ix_emails_received_at'), table_name='emails')
    op.drop_table('emails')
    op.drop_table('integrations')
