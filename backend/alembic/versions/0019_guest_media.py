"""guest messages: type + media

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-21

Let secret-link threads carry locations and images, not just text. `type` marks
the kind; `media` holds the encrypted-image ref (blob id + inline thumbnail),
both encrypted with the thread key K like everything else in the thread.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "guest_messages",
        sa.Column("type", sa.String(), nullable=False, server_default="text"),
    )
    op.add_column(
        "guest_messages",
        sa.Column("media", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("guest_messages", "media")
    op.drop_column("guest_messages", "type")
