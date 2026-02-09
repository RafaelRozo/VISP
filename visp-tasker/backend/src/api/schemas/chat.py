"""
Pydantic v2 schemas for the Chat API -- VISP-INT-REALTIME-004
==============================================================

Request/response schemas for REST chat endpoints.

All JSON responses use camelCase field names via Pydantic's alias
generator to match the mobile client convention.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _to_camel(snake: str) -> str:
    """Convert a snake_case string to camelCase."""
    parts = snake.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


class CamelModel(BaseModel):
    """Base model that serializes field names to camelCase in JSON."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=_to_camel,
    )


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------

class PaginationMeta(CamelModel):
    """Pagination metadata returned with list responses."""

    page: int = Field(ge=1, description="Current page number (1-indexed)")
    page_size: int = Field(ge=1, description="Items per page")
    total_items: int = Field(ge=0, description="Total matching items")
    total_pages: int = Field(ge=0, description="Total pages")


# ---------------------------------------------------------------------------
# Chat message output
# ---------------------------------------------------------------------------

class ChatMessageOut(CamelModel):
    """Single chat message in a list or creation response."""

    id: uuid.UUID
    job_id: uuid.UUID
    sender_id: uuid.UUID
    sender_name: Optional[str] = Field(
        default=None,
        description="Display name of the sender (resolved at query time)",
    )
    message: str = Field(description="Message text content")
    message_type: str = Field(description="Message type: text, image, or system")
    read_at: Optional[datetime] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Chat history response
# ---------------------------------------------------------------------------

class ChatHistoryResponse(CamelModel):
    """Paginated chat history for a job."""

    data: ChatHistoryData


class ChatHistoryData(CamelModel):
    """Wrapper containing the items list and pagination metadata."""

    items: list[ChatMessageOut]
    meta: PaginationMeta


# Fix forward reference
ChatHistoryResponse.model_rebuild()


# ---------------------------------------------------------------------------
# Send message
# ---------------------------------------------------------------------------

class SendMessageRequest(BaseModel):
    """Request body for sending a new chat message."""

    message: str = Field(
        min_length=1,
        max_length=1000,
        description="Message text (max 1000 characters)",
    )
    message_type: Optional[str] = Field(
        default="text",
        description="Message type: 'text', 'image', or 'system'",
    )

    @field_validator("message_type")
    @classmethod
    def validate_message_type(cls, v: Optional[str]) -> str:
        if v is None:
            return "text"
        allowed = {"text", "image", "system"}
        if v.lower() not in allowed:
            raise ValueError(f"message_type must be one of: {', '.join(sorted(allowed))}")
        return v.lower()


class SendMessageResponse(CamelModel):
    """Response after successfully sending a message."""

    data: ChatMessageOut


# ---------------------------------------------------------------------------
# Mark as read
# ---------------------------------------------------------------------------

class MarkReadResponse(CamelModel):
    """Response after marking messages as read."""

    data: None = None
    message: str = "Messages marked as read"


# ---------------------------------------------------------------------------
# Unread count
# ---------------------------------------------------------------------------

class UnreadCountData(CamelModel):
    """Unread message count payload."""

    count: int = Field(ge=0)


class UnreadCountResponse(CamelModel):
    """Response containing unread message count."""

    data: UnreadCountData
