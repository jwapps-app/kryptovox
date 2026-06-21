"""per-message disappearing window

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-21

Move the disappearing window onto each message (stamped at send time) so turning
the feature on only affects new messages — existing history is preserved. The
conversation's disappear_seconds remains the current setting for new messages.
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column(
            "disappear_seconds", sa.Integer(), nullable=False, server_default="0"
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "disappear_seconds")
