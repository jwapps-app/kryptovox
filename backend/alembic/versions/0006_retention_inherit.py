"""admin-adjustable global retention + per-conversation inherit

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-20

Model A: conversations inherit a live global default unless they set an explicit
override. retention_days becomes nullable (NULL = inherit the global), and the
global default lives in the new app_settings table so an admin can change it in
the app. Existing conversations are set to NULL so they follow the global.
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(), primary_key=True),
        sa.Column("value", sa.String(), nullable=False),
    )
    # NULL now means "inherit the global default".
    op.alter_column(
        "conversations",
        "retention_days",
        existing_type=sa.Integer(),
        nullable=True,
        server_default=None,
    )
    op.execute("UPDATE conversations SET retention_days = NULL")


def downgrade() -> None:
    op.execute("UPDATE conversations SET retention_days = 0 WHERE retention_days IS NULL")
    op.alter_column(
        "conversations",
        "retention_days",
        existing_type=sa.Integer(),
        nullable=False,
        server_default="0",
    )
    op.drop_table("app_settings")
