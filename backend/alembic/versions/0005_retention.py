"""conversation message retention

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-20

Per-conversation message retention. retention_days = 0 means keep forever (the
default, so existing conversations are unaffected); a positive value means the
sweeper deletes messages older than that many days.
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "retention_days", sa.Integer(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    op.drop_column("conversations", "retention_days")
