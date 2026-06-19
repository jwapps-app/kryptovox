"""add users.is_admin and bootstrap the oldest user as admin

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_admin", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    # Grant admin to the earliest-registered user (the server's first account),
    # so an existing deployment keeps a working admin after this migration.
    op.execute(
        """
        UPDATE users SET is_admin = true
        WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1)
        """
    )


def downgrade() -> None:
    op.drop_column("users", "is_admin")
