"""disappearing messages start on read

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-21

Add messages.disappear_started_at — the moment a disappearing message's clock
begins, set when the recipient first reads it (open time, not send time).
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("disappear_started_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "disappear_started_at")
