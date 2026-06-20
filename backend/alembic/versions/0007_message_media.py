"""image message media

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-20

Adds a nullable JSONB `media` column to messages for encrypted image
attachments (the full image lives as a blob in the media store; the thumbnail
and metadata are encrypted inline here).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("media", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "media")
