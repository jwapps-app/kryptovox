"""per-member pin / mute / clear

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-20

Per-user conversation prefs: pinned (sort to top), muted (no push), and
cleared_at (hide messages before this time for that member only).
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "conversation_members",
        sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "conversation_members",
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversation_members", "cleared_at")
    op.drop_column("conversation_members", "muted")
    op.drop_column("conversation_members", "pinned")
