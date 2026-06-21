"""disappearing messages

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-21

Per-conversation auto-delete timer (seconds; 0 = off). The sweeper deletes
messages older than the window; clients also hide them on time.
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "disappear_seconds", sa.Integer(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    op.drop_column("conversations", "disappear_seconds")
