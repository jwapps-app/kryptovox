"""performance indexes: conversation_members.user_id + messages(conversation_id, created_at)

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-30
"""
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ConversationMember PK is (conversation_id, user_id), so "WHERE user_id = ?"
    # (conversation list, unread totals, guest-unread) can't use the PK index and
    # table-scans. Index user_id directly.
    op.create_index(
        "ix_conversation_members_user_id",
        "conversation_members",
        ["user_id"],
    )
    # Unread/range counts filter by conversation_id AND created_at together; a
    # composite serves them better than the two separate single-column indexes.
    op.create_index(
        "ix_messages_conv_created",
        "messages",
        ["conversation_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_conv_created", table_name="messages")
    op.drop_index("ix_conversation_members_user_id", table_name="conversation_members")
