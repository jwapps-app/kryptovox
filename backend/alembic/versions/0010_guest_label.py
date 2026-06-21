"""secret-link label

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-20

Optional creator-set label for a secret-link thread, encrypted with the thread
key K (so it's server-blind and shown only on the creator's devices).
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("guest_threads", sa.Column("label_ciphertext", sa.Text(), nullable=True))
    op.add_column("guest_threads", sa.Column("label_iv", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("guest_threads", "label_iv")
    op.drop_column("guest_threads", "label_ciphertext")
