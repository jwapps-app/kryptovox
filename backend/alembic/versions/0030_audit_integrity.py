"""audit batch B: media ownership, hashed recovery verifier, sender key snapshot

- media_blobs: who uploaded each blob (user) or which guest thread it belongs
  to, so a note/message can only reference blobs the referencing principal
  owns — a client-supplied id could otherwise reference (and, via note
  deletion, destroy) another conversation's attachment.
- users.recovery_verifier: store sha256(verifier) rather than the verifier
  itself, so a database disclosure does not hand out a working password-reset
  credential. Existing values are hashed in place (one-way; clients still send
  the raw verifier, the server hashes before comparing).
- messages.sender_public_key: snapshot of the sender's identity key so
  recipients can still decrypt history after the sender's account is deleted
  (sender_id is SET NULL on delete and the client looked the key up by it).
  Backfilled from users for existing rows.

Revision ID: 0030
Revises: 0029
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_blobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column(
            "owner_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "thread_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("guest_threads.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_media_blobs_owner_id", "media_blobs", ["owner_id"])
    op.create_index("ix_media_blobs_thread_id", "media_blobs", ["thread_id"])

    op.execute(
        "UPDATE users SET recovery_verifier = "
        "encode(sha256(convert_to(recovery_verifier, 'UTF8')), 'hex') "
        "WHERE recovery_verifier IS NOT NULL"
    )

    op.add_column("messages", sa.Column("sender_public_key", sa.String(), nullable=True))
    op.execute(
        "UPDATE messages m SET sender_public_key = u.identity_public_key "
        "FROM users u WHERE m.sender_id = u.id AND m.sender_public_key IS NULL"
    )


def downgrade() -> None:
    op.drop_column("messages", "sender_public_key")
    # recovery_verifier hashing is one-way and cannot be reversed.
    op.drop_index("ix_media_blobs_thread_id", table_name="media_blobs")
    op.drop_index("ix_media_blobs_owner_id", table_name="media_blobs")
    op.drop_table("media_blobs")
