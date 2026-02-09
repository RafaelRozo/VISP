"""
Chat Service -- VISP-INT-REALTIME-004
======================================

Business logic for the in-app chat system.  Handles message persistence,
history retrieval, read receipts, and unread counts.

Chat is scoped to active jobs (MATCHED through COMPLETED) and restricted
to the customer and the assigned provider.

Business rules:
  - No free-text task modification through chat.
  - Provider cannot decide scope -- additional services require a new job.
  - All messages are persisted for audit and dispute resolution.
  - Safety keywords are flagged for human review (non-blocking).
"""

from __future__ import annotations

import logging
import math
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.chat import ChatMessage, MessageType
from src.models.job import AssignmentStatus, Job, JobAssignment, JobStatus
from src.models.provider import ProviderProfile
from src.models.user import User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ChatError(Exception):
    """Base exception for chat service errors."""
    pass


class JobNotFoundError(ChatError):
    """Raised when the job does not exist."""
    pass


class ChatNotAllowedError(ChatError):
    """Raised when chat is not permitted for the job's current status."""
    pass


class NotParticipantError(ChatError):
    """Raised when the user is not a participant of the job."""
    pass


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_MESSAGE_LENGTH: int = 1000

_CHAT_ALLOWED_STATUSES: frozenset = frozenset({
    JobStatus.MATCHED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED,
})

_SAFETY_KEYWORDS: List[str] = [
    "threat", "weapon", "hurt", "kill", "danger", "unsafe",
    "emergency", "police", "fire", "ambulance",
    "harass", "abuse", "assault",
]

_SAFETY_PATTERN: re.Pattern = re.compile(
    r"\b(" + "|".join(re.escape(kw) for kw in _SAFETY_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------

@dataclass
class ChatMessageDTO:
    """Flat representation of a chat message for API responses."""

    id: uuid.UUID
    job_id: uuid.UUID
    sender_id: uuid.UUID
    sender_name: Optional[str]
    message: str
    message_type: str
    read_at: Optional[datetime]
    created_at: datetime


@dataclass
class PaginatedMessages:
    """Container for a paginated list of messages."""

    items: List[ChatMessageDTO]
    page: int
    page_size: int
    total_items: int
    total_pages: int


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _check_safety(message_text: str, job_id: uuid.UUID, sender_id: uuid.UUID) -> bool:
    """Check for safety-related keywords.  Logs but does not block."""
    match = _SAFETY_PATTERN.search(message_text)
    if match:
        logger.warning(
            "SAFETY FLAG: keyword='%s' in message from user=%s on job=%s",
            match.group(), sender_id, job_id,
        )
        return True
    return False


async def _get_sender_display_name(
    db: AsyncSession,
    sender_id: uuid.UUID,
) -> str:
    """Resolve a user's display name from the database."""
    stmt = select(
        User.first_name,
        User.last_name,
        User.display_name,
    ).where(User.id == sender_id)
    result = await db.execute(stmt)
    row = result.one_or_none()
    if row is None:
        return "Unknown"
    if row.display_name:
        return row.display_name
    name = f"{row.first_name} {row.last_name}".strip()
    return name or "Unknown"


async def _verify_participant(
    db: AsyncSession,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    require_active_chat: bool = True,
) -> Job:
    """Verify the user is a participant of the job and chat is allowed.

    Returns the Job on success.

    Raises:
        JobNotFoundError: If the job does not exist.
        ChatNotAllowedError: If the job status does not permit chat.
        NotParticipantError: If the user is neither customer nor assigned provider.
    """
    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        raise JobNotFoundError(f"Job '{job_id}' not found")

    if require_active_chat and job.status not in _CHAT_ALLOWED_STATUSES:
        raise ChatNotAllowedError(
            f"Chat is not available when the job is in '{job.status.value}' status"
        )

    # Check if user is the customer
    if job.customer_id == user_id:
        return job

    # Check if user is the assigned provider
    assign_stmt = select(JobAssignment.provider_id).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status.in_([
            AssignmentStatus.ACCEPTED,
            AssignmentStatus.COMPLETED,
        ]),
    )
    assign_result = await db.execute(assign_stmt)
    provider_ids = [row.provider_id for row in assign_result.all()]

    if provider_ids:
        # Resolve provider_profile.user_id for each assignment
        prov_stmt = select(ProviderProfile.user_id).where(
            ProviderProfile.id.in_(provider_ids),
        )
        prov_result = await db.execute(prov_stmt)
        provider_user_ids = {row.user_id for row in prov_result.all()}
        if user_id in provider_user_ids:
            return job

    raise NotParticipantError("You are not a participant in this job")


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------

async def get_messages(
    db: AsyncSession,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    page: int = 1,
    page_size: int = 50,
    before: Optional[datetime] = None,
) -> PaginatedMessages:
    """Retrieve paginated chat history for a job.

    Messages are returned in ascending chronological order (oldest first)
    so the client can render them naturally in a chat view.

    Args:
        db: Async database session.
        job_id: The job to fetch messages for.
        user_id: The requesting user (must be a participant).
        page: Page number (1-indexed).
        page_size: Number of messages per page.
        before: Optional timestamp cursor -- only return messages before this time.

    Returns:
        PaginatedMessages with items and pagination metadata.
    """
    # Verify participant (allow viewing history even after completion)
    await _verify_participant(db, job_id, user_id, require_active_chat=False)

    # Base filter
    conditions = [ChatMessage.job_id == job_id]

    if before is not None:
        conditions.append(ChatMessage.created_at < before)

    where_clause = and_(*conditions)

    # Total count
    count_stmt = select(func.count()).select_from(ChatMessage).where(where_clause)
    total_items = (await db.execute(count_stmt)).scalar() or 0
    total_pages = max(1, math.ceil(total_items / page_size))

    # Fetch page (ascending order for chat UX)
    offset = (page - 1) * page_size
    msg_stmt = (
        select(ChatMessage)
        .where(where_clause)
        .order_by(ChatMessage.created_at.asc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(msg_stmt)
    messages = result.scalars().all()

    # Resolve sender names in bulk
    sender_ids = list({msg.sender_id for msg in messages})
    sender_names: dict[uuid.UUID, str] = {}
    if sender_ids:
        name_stmt = select(
            User.id, User.first_name, User.last_name, User.display_name,
        ).where(User.id.in_(sender_ids))
        name_result = await db.execute(name_stmt)
        for row in name_result.all():
            if row.display_name:
                sender_names[row.id] = row.display_name
            else:
                name = f"{row.first_name} {row.last_name}".strip()
                sender_names[row.id] = name or "Unknown"

    items = [
        ChatMessageDTO(
            id=msg.id,
            job_id=msg.job_id,
            sender_id=msg.sender_id,
            sender_name=sender_names.get(msg.sender_id, "Unknown"),
            message=msg.message_text,
            message_type=msg.message_type.value if isinstance(msg.message_type, MessageType) else str(msg.message_type),
            read_at=msg.read_at,
            created_at=msg.created_at,
        )
        for msg in messages
    ]

    return PaginatedMessages(
        items=items,
        page=page,
        page_size=page_size,
        total_items=total_items,
        total_pages=total_pages,
    )


async def send_message(
    db: AsyncSession,
    job_id: uuid.UUID,
    sender_id: uuid.UUID,
    message_text: str,
    message_type_str: str = "text",
) -> ChatMessageDTO:
    """Persist and return a new chat message.

    Args:
        db: Async database session.
        job_id: The job this message belongs to.
        sender_id: The user sending the message.
        message_text: The message content.
        message_type_str: One of 'text', 'image', 'system'.

    Returns:
        ChatMessageDTO for the newly created message.

    Raises:
        ChatError subclass if validation fails.
        ValueError if message_type is invalid or message is too long.
    """
    # Validate message content
    message_text = message_text.strip()
    if not message_text:
        raise ValueError("Message text cannot be empty")
    if len(message_text) > MAX_MESSAGE_LENGTH:
        raise ValueError(
            f"Message exceeds maximum length of {MAX_MESSAGE_LENGTH} characters"
        )

    # Validate message type
    try:
        message_type = MessageType(message_type_str.lower())
    except ValueError:
        valid = ", ".join(t.value for t in MessageType)
        raise ValueError(f"Invalid message_type. Must be one of: {valid}")

    # Verify participant and job status
    await _verify_participant(db, job_id, sender_id, require_active_chat=True)

    # Safety check (non-blocking, log only)
    _check_safety(message_text, job_id, sender_id)

    # Persist
    msg = ChatMessage(
        job_id=job_id,
        sender_id=sender_id,
        message_text=message_text,
        message_type=message_type,
        read_by_recipient=False,
    )
    db.add(msg)
    await db.flush()

    # Resolve sender name
    sender_name = await _get_sender_display_name(db, sender_id)

    logger.info(
        "Chat message created: id=%s job=%s sender=%s type=%s len=%d",
        msg.id, job_id, sender_id, message_type.value, len(message_text),
    )

    return ChatMessageDTO(
        id=msg.id,
        job_id=msg.job_id,
        sender_id=msg.sender_id,
        sender_name=sender_name,
        message=msg.message_text,
        message_type=message_type.value,
        read_at=None,
        created_at=msg.created_at,
    )


async def mark_messages_read(
    db: AsyncSession,
    job_id: uuid.UUID,
    reader_id: uuid.UUID,
) -> int:
    """Mark all unread messages in a job as read for the requesting user.

    Only marks messages sent by OTHER users as read (you cannot mark your
    own messages as read).

    Args:
        db: Async database session.
        job_id: The job whose messages to mark as read.
        reader_id: The user marking messages as read.

    Returns:
        Number of messages that were updated.
    """
    await _verify_participant(db, job_id, reader_id, require_active_chat=False)

    now = datetime.now(timezone.utc)

    stmt = (
        update(ChatMessage)
        .where(
            ChatMessage.job_id == job_id,
            ChatMessage.sender_id != reader_id,
            ChatMessage.read_by_recipient == False,  # noqa: E712
        )
        .values(read_by_recipient=True, read_at=now)
    )
    result = await db.execute(stmt)
    updated_count = result.rowcount

    if updated_count > 0:
        logger.info(
            "Marked %d messages as read: job=%s reader=%s",
            updated_count, job_id, reader_id,
        )

    return updated_count


async def get_unread_count(
    db: AsyncSession,
    job_id: uuid.UUID,
    user_id: uuid.UUID,
) -> int:
    """Get the count of unread messages for a user in a job.

    Counts messages sent by OTHER users that have not been read.

    Args:
        db: Async database session.
        job_id: The job to count unread messages for.
        user_id: The user requesting the count.

    Returns:
        Integer count of unread messages.
    """
    await _verify_participant(db, job_id, user_id, require_active_chat=False)

    stmt = (
        select(func.count())
        .select_from(ChatMessage)
        .where(
            ChatMessage.job_id == job_id,
            ChatMessage.sender_id != user_id,
            ChatMessage.read_by_recipient == False,  # noqa: E712
        )
    )
    result = await db.execute(stmt)
    return result.scalar() or 0
