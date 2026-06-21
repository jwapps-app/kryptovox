"""secret-link host read state

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-20

Tracks when the creator last read a guest thread, so a guest reply can mark the
thread unread (and drive the app-icon badge) until the creator opens it.
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "guest_threads",
        sa.Column("host_read_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("guest_threads", "host_read_at")
