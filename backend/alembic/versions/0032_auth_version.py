"""client-derived authentication secret (auth_version)

The password used to unwrap the E2EE identity key must never reach the
server. Clients now send HKDF-SHA256(password, salt="kryptovox-auth-v1",
info=username) as the login credential; the server bcrypts *that*. Existing
accounts (auth_version 1) still hold bcrypt(raw password) and are upgraded in
place on their next login from a current client.

Revision ID: 0032
Revises: 0031
"""
import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("auth_version", sa.Integer(), nullable=False, server_default="1"),
    )


def downgrade() -> None:
    op.drop_column("users", "auth_version")
