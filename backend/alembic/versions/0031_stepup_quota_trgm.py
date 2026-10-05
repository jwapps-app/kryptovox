"""token versioning, storage quota accounting, username search index

- users.token_version: embedded in access tokens; bumping it on a password
  change / recovery / admin reset invalidates every outstanding access token
  immediately instead of at expiry.
- media_blobs.size_bytes: ciphertext size per upload, so a per-account storage
  quota is a single SUM. Existing rows are backfilled from the files on disk
  where present.
- users.username trigram index (pg_trgm) so the ILIKE '%q%' search is indexed.
  The extension is trusted in PostgreSQL 13+, so the DB owner can create it;
  if this server can't, the index is skipped with a notice and search stays
  sequential (correct, just unindexed).

Revision ID: 0031
Revises: 0030
"""
import logging
import os

import sqlalchemy as sa
from alembic import op

from app.config import settings

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "media_blobs",
        sa.Column("size_bytes", sa.BigInteger(), nullable=False, server_default="0"),
    )

    # Backfill sizes from the media directory (same container as the API).
    media_dir = settings.media_dir
    conn = op.get_bind()
    if os.path.isdir(media_dir):
        ids = [r[0] for r in conn.execute(sa.text("SELECT id FROM media_blobs")).fetchall()]
        for media_id in ids:
            try:
                size = os.path.getsize(os.path.join(media_dir, media_id))
            except OSError:
                continue
            conn.execute(
                sa.text("UPDATE media_blobs SET size_bytes = :s WHERE id = :id"),
                {"s": size, "id": media_id},
            )

    # Trigram index for the username search; best-effort (needs pg_trgm).
    try:
        with conn.begin_nested():
            conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            conn.execute(
                sa.text(
                    "CREATE INDEX IF NOT EXISTS ix_users_username_trgm "
                    "ON users USING gin (username gin_trgm_ops)"
                )
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("pg_trgm unavailable, username search stays unindexed: %s", exc)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_username_trgm")
    op.drop_column("media_blobs", "size_bytes")
    op.drop_column("users", "token_version")
