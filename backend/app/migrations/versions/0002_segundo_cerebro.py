"""Segundo cerebro: notas, tareas, calendario, recordatorios, seguridad y cola de trabajos.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('account',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('password_hash', sa.Text(), nullable=False),
    sa.Column('totp_secret_encrypted', sa.LargeBinary(), nullable=True),
    sa.Column('totp_enabled', sa.Boolean(), nullable=False),
    sa.Column('feed_token', sa.String(length=64), nullable=False),
    sa.Column('vapid_private_pem', sa.Text(), nullable=True),
    sa.Column('vapid_public_key', sa.Text(), nullable=True),
    sa.Column('prefs', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('audit_log',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('action', sa.String(length=60), nullable=False),
    sa.Column('ip', postgresql.INET(), nullable=True),
    sa.Column('detail', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_at'), 'audit_log', ['at'], unique=False)
    op.create_table('calendars',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('color', sa.String(length=20), nullable=False),
    sa.Column('source', sa.String(length=10), nullable=False),
    sa.Column('url_encrypted', sa.LargeBinary(), nullable=True),
    sa.Column('enabled', sa.Boolean(), nullable=False),
    sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sync_error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('conversations',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('messages', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('api_messages', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_conversations_updated_at'), 'conversations', ['updated_at'], unique=False)
    op.create_table('jobs',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('kind', sa.String(length=40), nullable=False),
    sa.Column('payload', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('run_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('max_attempts', sa.Integer(), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('login_attempts',
    sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
    sa.Column('ip', postgresql.INET(), nullable=False),
    sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('success', sa.Boolean(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_login_attempts_at'), 'login_attempts', ['at'], unique=False)
    op.create_index(op.f('ix_login_attempts_ip'), 'login_attempts', ['ip'], unique=False)
    op.create_table('notifications',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('kind', sa.String(length=20), nullable=False),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('url', sa.Text(), nullable=True),
    sa.Column('dedupe_key', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('pushed_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('dedupe_key')
    )
    op.create_index(op.f('ix_notifications_created_at'), 'notifications', ['created_at'], unique=False)
    op.create_table('projects',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('name', sa.Text(), nullable=False),
    sa.Column('kind', sa.String(length=10), nullable=False),
    sa.Column('color', sa.String(length=20), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('push_subscriptions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('endpoint', sa.Text(), nullable=False),
    sa.Column('p256dh', sa.Text(), nullable=False),
    sa.Column('auth', sa.Text(), nullable=False),
    sa.Column('user_agent', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('endpoint')
    )
    op.create_table('sessions',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ip', postgresql.INET(), nullable=True),
    sa.Column('user_agent', sa.Text(), nullable=True),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('events',
    sa.Column('item_id', sa.UUID(), nullable=False),
    sa.Column('calendar_id', sa.UUID(), nullable=False),
    sa.Column('starts_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('ends_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('all_day', sa.Boolean(), nullable=False),
    sa.Column('location', sa.Text(), nullable=True),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('rrule', sa.Text(), nullable=True),
    sa.Column('repeat_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('remind_minutes', sa.Integer(), nullable=True),
    sa.Column('external_key', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['calendar_id'], ['calendars.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id'),
    sa.UniqueConstraint('calendar_id', 'external_key')
    )
    op.create_index(op.f('ix_events_calendar_id'), 'events', ['calendar_id'], unique=False)
    op.create_index(op.f('ix_events_ends_at'), 'events', ['ends_at'], unique=False)
    op.create_index(op.f('ix_events_starts_at'), 'events', ['starts_at'], unique=False)
    op.create_table('item_links',
    sa.Column('source_id', sa.UUID(), nullable=False),
    sa.Column('target_id', sa.UUID(), nullable=False),
    sa.ForeignKeyConstraint(['source_id'], ['items.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['target_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('source_id', 'target_id')
    )
    op.create_index(op.f('ix_item_links_target_id'), 'item_links', ['target_id'], unique=False)
    op.create_table('notes',
    sa.Column('item_id', sa.UUID(), nullable=False),
    sa.Column('body', sa.Text(), nullable=False),
    sa.Column('journal_date', sa.Date(), nullable=True),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id'),
    sa.UniqueConstraint('journal_date')
    )
    op.create_table('reminders',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('item_id', sa.UUID(), nullable=True),
    sa.Column('title', sa.Text(), nullable=False),
    sa.Column('remind_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('dismissed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_reminders_item_id'), 'reminders', ['item_id'], unique=False)
    op.create_index(op.f('ix_reminders_remind_at'), 'reminders', ['remind_at'], unique=False)
    op.create_table('tasks',
    sa.Column('item_id', sa.UUID(), nullable=False),
    sa.Column('notes', sa.Text(), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('due_time', sa.Time(), nullable=True),
    sa.Column('priority', sa.SmallInteger(), nullable=False),
    sa.Column('done_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('rrule', sa.Text(), nullable=True),
    sa.Column('remind', sa.Boolean(), nullable=False),
    sa.Column('sort', sa.Float(), nullable=False),
    sa.ForeignKeyConstraint(['item_id'], ['items.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('item_id')
    )
    op.create_index(op.f('ix_tasks_done_at'), 'tasks', ['done_at'], unique=False)
    op.create_index(op.f('ix_tasks_due_date'), 'tasks', ['due_date'], unique=False)
    op.add_column('items', sa.Column('pinned', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('items', sa.Column('project_id', sa.UUID(), nullable=True))
    op.create_index(op.f('ix_items_expires_on'), 'items', ['expires_on'], unique=False)
    op.create_index(op.f('ix_items_project_id'), 'items', ['project_id'], unique=False)
    op.create_foreign_key('items_project_id_fkey', 'items', 'projects', ['project_id'], ['id'], ondelete='SET NULL')

    # La cola solo mira los trabajos pendientes: índice parcial pequeño.
    op.execute("CREATE INDEX jobs_queue_idx ON jobs (run_at) WHERE status = 'queued'")
    # Calendario propio por defecto.
    op.execute(
        "INSERT INTO calendars (id, name, color, source, enabled) "
        "VALUES (gen_random_uuid(), 'Personal', 'cobalt', 'local', true)"
    )
    # Los documentos que la fase 0 dejó pendientes pasan a la nueva cola.
    op.execute(
        "INSERT INTO jobs (kind, payload, status, attempts, max_attempts) "
        "SELECT 'process_document', jsonb_build_object('item_id', id::text), 'queued', 0, 3 "
        "FROM items WHERE status IN ('pending', 'processing')"
    )
    op.execute("UPDATE items SET status = 'pending' WHERE status = 'processing'")


def downgrade() -> None:
    op.drop_constraint('items_project_id_fkey', 'items', type_='foreignkey')
    op.drop_index(op.f('ix_items_project_id'), table_name='items')
    op.drop_index(op.f('ix_items_expires_on'), table_name='items')
    op.drop_column('items', 'project_id')
    op.drop_column('items', 'pinned')
    op.drop_index(op.f('ix_tasks_due_date'), table_name='tasks')
    op.drop_index(op.f('ix_tasks_done_at'), table_name='tasks')
    op.drop_table('tasks')
    op.drop_index(op.f('ix_reminders_remind_at'), table_name='reminders')
    op.drop_index(op.f('ix_reminders_item_id'), table_name='reminders')
    op.drop_table('reminders')
    op.drop_table('notes')
    op.drop_index(op.f('ix_item_links_target_id'), table_name='item_links')
    op.drop_table('item_links')
    op.drop_index(op.f('ix_events_starts_at'), table_name='events')
    op.drop_index(op.f('ix_events_ends_at'), table_name='events')
    op.drop_index(op.f('ix_events_calendar_id'), table_name='events')
    op.drop_table('events')
    op.drop_table('sessions')
    op.drop_table('push_subscriptions')
    op.drop_table('projects')
    op.drop_index(op.f('ix_notifications_created_at'), table_name='notifications')
    op.drop_table('notifications')
    op.drop_index(op.f('ix_login_attempts_ip'), table_name='login_attempts')
    op.drop_index(op.f('ix_login_attempts_at'), table_name='login_attempts')
    op.drop_table('login_attempts')
    op.drop_table('jobs')
    op.drop_index(op.f('ix_conversations_updated_at'), table_name='conversations')
    op.drop_table('conversations')
    op.drop_table('calendars')
    op.drop_index(op.f('ix_audit_log_at'), table_name='audit_log')
    op.drop_table('audit_log')
    op.drop_table('account')
