"""secret-link burn-after-open

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-20

burn_minutes != NULL marks a "burn after reading" thread: its expires_at stays
NULL until the guest first opens it, then is set to now + burn_minutes. After
that window the guest loses access, and the thread is deleted once the creator
has read it (or auto-cleaned after a safety cap).
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("guest_threads", sa.Column("burn_minutes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("guest_threads", "burn_minutes")
