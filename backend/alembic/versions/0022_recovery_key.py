"""account recovery key

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-23

A second, recovery-key-wrapped copy of the identity private key, plus a verifier
(hash of the recovery key) so the server can authorize a password reset without
ever seeing the recovery key — it can't decrypt the blob.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("recovery_key_blob", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "users", sa.Column("recovery_verifier", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("users", "recovery_verifier")
    op.drop_column("users", "recovery_key_blob")
