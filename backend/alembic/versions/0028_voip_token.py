"""add voip_token to apns_tokens (PushKit / CallKit ringing)

Revision ID: 0028
Revises: 0027
"""
import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "apns_tokens", sa.Column("voip_token", sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("apns_tokens", "voip_token")
