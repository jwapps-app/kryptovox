"""drop redundant single-column message indexes

The composite ix_messages_conv_created (0025) fully covers filtering by
conversation_id (its leading column) and every created_at query also filters by
conversation. The two standalone indexes from 0001 only added write cost on the
highest-volume table.

Revision ID: 0029
Revises: 0028
"""
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_messages_conversation_id", table_name="messages")
    op.drop_index("ix_messages_created_at", table_name="messages")


def downgrade() -> None:
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])
