"""private E2EE notes

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-21

A per-user encrypted notebook. Title/body are ciphertext; the per-note key is
wrapped only to the owner (self-ECDH). Server is zero-knowledge.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("wrapped_key", sa.Text(), nullable=False),
        sa.Column("title_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("title_iv", sa.String(), nullable=False, server_default=""),
        sa.Column("body_ciphertext", sa.Text(), nullable=False, server_default=""),
        sa.Column("body_iv", sa.String(), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_notes_owner_id", "notes", ["owner_id"])


def downgrade() -> None:
    op.drop_index("ix_notes_owner_id", table_name="notes")
    op.drop_table("notes")
