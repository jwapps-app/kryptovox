"""note attachments

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-23

Encrypted file attachments on notes. Metadata (incl. the filename, encrypted
with the note key) lives in a JSONB list on the note; the encrypted blobs live in
the media store, keyed by the ids referenced here.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notes",
        sa.Column(
            "attachments",
            postgresql.JSONB(),
            nullable=False,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("notes", "attachments")
