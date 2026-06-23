"""track last-used TOTP step (replay protection)

Revision ID: 0024
Revises: 0023
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The timestep of the most recently accepted TOTP code; a new code must have a
    # strictly greater step, so a captured code can't be replayed within its window.
    op.add_column(
        "users",
        sa.Column("totp_last_step", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "totp_last_step")
