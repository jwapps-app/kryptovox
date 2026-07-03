"""store passkey transports so login routes to the local authenticator

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Comma-separated transport hints (e.g. "internal,hybrid") reported by the
    # authenticator at registration. Passed back in the login allow-credentials
    # so the browser goes straight to a local passkey instead of the QR flow.
    op.add_column(
        "webauthn_credentials",
        sa.Column("transports", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("webauthn_credentials", "transports")
