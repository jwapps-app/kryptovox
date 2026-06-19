"""per-user synced identity keys

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-19

Switches from per-device keys to one identity per user (synced to devices,
encrypted under the user's password). Old messages were wrapped to per-device
keys that the new scheme can't read, so they're cleared — they could not be
decrypted cross-device anyway.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("identity_public_key", sa.String(), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("encrypted_private_key", postgresql.JSONB(), nullable=True),
    )
    # Device public key is now optional (messaging uses the user identity key).
    op.alter_column("devices", "public_key", existing_type=sa.String(), nullable=True)

    # Clear old-format (per-device-wrapped) messages — incompatible with the
    # new per-user wrapping and unreadable on newly-synced devices.
    op.execute("DELETE FROM message_reactions")
    op.execute("DELETE FROM message_receipts")
    op.execute("DELETE FROM messages")
    op.execute("UPDATE conversation_members SET last_read_message_id = NULL")


def downgrade() -> None:
    op.alter_column("devices", "public_key", existing_type=sa.String(), nullable=False)
    op.drop_column("users", "encrypted_private_key")
    op.drop_column("users", "identity_public_key")
