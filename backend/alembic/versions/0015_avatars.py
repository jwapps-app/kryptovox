"""E2EE profile photos

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-21

Per-user encrypted avatar (ciphertext + iv + self-wrapped key on the user row)
plus a table of the avatar key wrapped for each contact who may view it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_ciphertext", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("avatar_iv", sa.String(), nullable=True))
    op.add_column("users", sa.Column("avatar_self_key", sa.Text(), nullable=True))
    op.create_table(
        "avatar_keys",
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "recipient_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("wrapped_key", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("avatar_keys")
    op.drop_column("users", "avatar_self_key")
    op.drop_column("users", "avatar_iv")
    op.drop_column("users", "avatar_ciphertext")
