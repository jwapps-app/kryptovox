"""manual mark-as-unread

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-20

Adds conversation_members.marked_unread so a user can mark a conversation
unread even after reading it (shows a count of 1 when nothing newer exists).
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_members",
        sa.Column(
            "marked_unread", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("conversation_members", "marked_unread")
