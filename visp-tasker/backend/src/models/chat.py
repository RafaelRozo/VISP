"""
SQLAlchemy model for in-app chat messages.
Corresponds to migration XXX_create_chat_messages.sql.

Chat messages are scoped to an active job and exchanged between the
assigned provider and the customer.  Messages are persisted for audit
and dispute resolution.

Business rule: No free-text task modification is allowed through chat.
The provider cannot decide scope -- additional services require a new job.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class MessageType(str, enum.Enum):
    TEXT = "text"
    IMAGE = "image"
    SYSTEM = "system"


class ChatMessage(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Persisted chat message between customer and provider during a job."""

    __tablename__ = "chat_messages"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    message_text: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )

    message_type: Mapped[MessageType] = mapped_column(
        Enum(MessageType, name="message_type", create_type=False),
        nullable=False,
        server_default="TEXT",
    )

    read_by_recipient: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )

    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", backref="chat_messages")
    sender: Mapped["User"] = relationship("User")

    def __repr__(self) -> str:
        return (
            f"<ChatMessage(id={self.id}, job_id={self.job_id}, "
            f"sender_id={self.sender_id}, type={self.message_type})>"
        )
