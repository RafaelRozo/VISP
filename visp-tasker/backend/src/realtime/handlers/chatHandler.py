"""
In-App Chat Handler -- VISP-INT-REALTIME-004
=============================================

WebSocket handler for real-time messaging between customer and provider
on the ``/chat`` namespace. Chat is scoped to active jobs (from matched
through completed status) and all messages are persisted for audit and
dispute resolution.

Business rules:
  - Chat only available during active jobs (matched -> completed)
  - Max message length: 1000 characters
  - No free-text task modification through chat (provider cannot decide
    scope -- additional services require a new job)
  - Messages containing safety keywords are flagged and logged
  - Profanity filter is a placeholder for a production-grade service

Events received FROM clients:
  chat:send_message   { job_id, message_text, message_type }
  chat:typing         { job_id }
  chat:read_receipt   { job_id, message_id }

Events emitted TO clients:
  chat:new_message    { message_id, job_id, sender_id, sender_name, message_text, message_type, sent_at }
  chat:user_typing    { job_id, user_id, user_name }
  chat:message_read   { job_id, message_id, read_by, read_at }
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from src.api.deps import async_session_factory
from src.models.chat import ChatMessage, MessageType
from src.models.job import Job, JobStatus
from src.models.user import User

from ..socketServer import (
    broadcast_to_job,
    get_sid_meta,
    sio,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_MESSAGE_LENGTH: int = 1000

# Job statuses during which chat is permitted
_CHAT_ALLOWED_STATUSES: frozenset[JobStatus] = frozenset({
    JobStatus.MATCHED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED,
})

# Safety keywords that trigger logging for review.  In production this
# would be backed by a configurable list or an ML-based classifier.
_SAFETY_KEYWORDS: list[str] = [
    "threat",
    "weapon",
    "hurt",
    "kill",
    "danger",
    "unsafe",
    "emergency",
    "police",
    "fire",
    "ambulance",
    "harass",
    "abuse",
    "assault",
]

_SAFETY_PATTERN: re.Pattern[str] = re.compile(
    r"\b(" + "|".join(re.escape(kw) for kw in _SAFETY_KEYWORDS) + r")\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _check_safety(message_text: str, job_id: str, sender_id: str) -> bool:
    """Check message text for safety-related keywords.

    Returns True if a safety keyword was detected.  Logs the flagged
    message for human review.  Does NOT block the message from being sent.
    """
    match = _SAFETY_PATTERN.search(message_text)
    if match:
        logger.warning(
            "SAFETY FLAG: keyword='%s' in message from user=%s on job=%s",
            match.group(),
            sender_id,
            job_id,
        )
        return True
    return False


async def _get_sender_display_name(sender_id: str) -> str:
    """Fetch the sender's display name from the database.

    Falls back to first_name if display_name is not set.
    """
    try:
        async with async_session_factory() as db:
            stmt = select(
                User.first_name,
                User.last_name,
                User.display_name,
            ).where(User.id == uuid.UUID(sender_id))
            result = await db.execute(stmt)
            row = result.one_or_none()
            if row is None:
                return "Unknown"
            if row.display_name:
                return row.display_name
            return f"{row.first_name} {row.last_name}".strip() or "Unknown"
    except Exception:
        logger.exception("Failed to fetch display name for user=%s", sender_id)
        return "Unknown"


async def _verify_chat_participant(
    job_id: str,
    sender_id: str,
) -> tuple[bool, str | None, Job | None]:
    """Verify the sender is a participant in the job and chat is allowed.

    Returns (allowed, error_message, job).
    """
    try:
        async with async_session_factory() as db:
            stmt = select(Job).where(Job.id == uuid.UUID(job_id))
            result = await db.execute(stmt)
            job = result.scalar_one_or_none()

            if job is None:
                return False, "Job not found", None

            if job.status not in _CHAT_ALLOWED_STATUSES:
                return (
                    False,
                    f"Chat not available in '{job.status.value}' status",
                    None,
                )

            # Check if sender is the customer
            if str(job.customer_id) == sender_id:
                return True, None, job

            # Check if sender is the assigned provider
            from src.models.job import AssignmentStatus, JobAssignment

            assign_stmt = select(JobAssignment).where(
                JobAssignment.job_id == uuid.UUID(job_id),
                JobAssignment.status.in_([
                    AssignmentStatus.ACCEPTED,
                    AssignmentStatus.COMPLETED,
                ]),
            )
            assign_result = await db.execute(assign_stmt)
            assignments = assign_result.scalars().all()

            for assignment in assignments:
                # Need to check the provider's user_id via provider_profiles
                from src.models.provider import ProviderProfile

                prov_stmt = select(ProviderProfile.user_id).where(
                    ProviderProfile.id == assignment.provider_id,
                )
                prov_result = await db.execute(prov_stmt)
                prov_row = prov_result.one_or_none()
                if prov_row and str(prov_row.user_id) == sender_id:
                    return True, None, job

            return False, "You are not a participant in this job", None

    except Exception:
        logger.exception("Error verifying chat participant for job=%s", job_id)
        return False, "Internal error", None


# ---------------------------------------------------------------------------
# Inbound event handlers
# ---------------------------------------------------------------------------

@sio.on("chat:send_message", namespace="/chat")
async def handle_send_message(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Handle a new chat message from a client.

    Payload: {
        "job_id": "<uuid>",
        "message_text": "<string>",
        "message_type": "text" | "image" | "system"    (default: "text")
    }

    Validation:
      - Sender must be authenticated and a participant of the job
      - Job must be in an active status
      - Message text must not exceed 1000 characters
      - Message type must be valid

    On success:
      - Message is persisted to the chat_messages table
      - Safety check is performed (log only, does not block)
      - ``chat:new_message`` is emitted to the job room
    """
    meta = get_sid_meta(sid)
    if not meta:
        return {"ok": False, "error": "Not authenticated"}

    sender_id: str = meta.get("user_id", "")

    # Validate payload
    job_id = data.get("job_id")
    message_text = data.get("message_text", "").strip()
    message_type_str = data.get("message_type", "text")

    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    if not message_text:
        return {"ok": False, "error": "message_text is required"}

    if len(message_text) > MAX_MESSAGE_LENGTH:
        return {
            "ok": False,
            "error": f"Message exceeds maximum length of {MAX_MESSAGE_LENGTH} characters",
        }

    # Validate message type
    try:
        message_type = MessageType(message_type_str)
    except ValueError:
        return {
            "ok": False,
            "error": f"Invalid message_type. Must be one of: {', '.join(t.value for t in MessageType)}",
        }

    # Verify participant and job status
    allowed, error, job = await _verify_chat_participant(job_id, sender_id)
    if not allowed:
        return {"ok": False, "error": error}

    # Safety check (non-blocking, log only)
    _check_safety(message_text, job_id, sender_id)

    # Persist message
    now = datetime.now(timezone.utc)
    message_id = uuid.uuid4()

    try:
        async with async_session_factory() as db:
            chat_msg = ChatMessage(
                id=message_id,
                job_id=uuid.UUID(job_id),
                sender_id=uuid.UUID(sender_id),
                message_text=message_text,
                message_type=message_type,
                read_by_recipient=False,
            )
            db.add(chat_msg)
            await db.commit()
    except Exception:
        logger.exception("Failed to persist chat message for job=%s", job_id)
        return {"ok": False, "error": "Failed to save message"}

    # Fetch sender display name
    sender_name = await _get_sender_display_name(sender_id)

    # Broadcast to job room
    sent_at = now.isoformat()
    await broadcast_to_job(
        job_id,
        "chat:new_message",
        {
            "message_id": str(message_id),
            "job_id": job_id,
            "sender_id": sender_id,
            "sender_name": sender_name,
            "message_text": message_text,
            "message_type": message_type.value,
            "sent_at": sent_at,
        },
        namespace="/chat",
    )

    logger.info(
        "Chat message sent: job=%s sender=%s type=%s len=%d",
        job_id, sender_id, message_type.value, len(message_text),
    )
    return {
        "ok": True,
        "message_id": str(message_id),
        "sent_at": sent_at,
    }


@sio.on("chat:typing", namespace="/chat")
async def handle_typing(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Handle typing indicator from a client.

    Payload: { "job_id": "<uuid>" }

    Broadcasts ``chat:user_typing`` to the job room (excluding the sender).
    This is a lightweight event -- no persistence, no heavy validation.
    """
    meta = get_sid_meta(sid)
    if not meta:
        return {"ok": False, "error": "Not authenticated"}

    sender_id: str = meta.get("user_id", "")
    job_id = data.get("job_id")

    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    # Lightweight: fetch name for display (cached in production)
    sender_name = await _get_sender_display_name(sender_id)

    await broadcast_to_job(
        job_id,
        "chat:user_typing",
        {
            "job_id": job_id,
            "user_id": sender_id,
            "user_name": sender_name,
        },
        namespace="/chat",
        skip_sid=sid,
    )

    return {"ok": True}


@sio.on("chat:read_receipt", namespace="/chat")
async def handle_read_receipt(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Handle a read receipt from a client.

    Payload: { "job_id": "<uuid>", "message_id": "<uuid>" }

    Marks the message as read and broadcasts ``chat:message_read`` to
    the job room so the sender's UI can update the delivery indicator.
    """
    meta = get_sid_meta(sid)
    if not meta:
        return {"ok": False, "error": "Not authenticated"}

    reader_id: str = meta.get("user_id", "")
    job_id = data.get("job_id")
    message_id = data.get("message_id")

    if not job_id or not message_id:
        return {"ok": False, "error": "job_id and message_id are required"}

    now = datetime.now(timezone.utc)

    # Update the message in the database
    try:
        async with async_session_factory() as db:
            stmt = select(ChatMessage).where(
                ChatMessage.id == uuid.UUID(message_id),
                ChatMessage.job_id == uuid.UUID(job_id),
            )
            result = await db.execute(stmt)
            msg = result.scalar_one_or_none()

            if msg is None:
                return {"ok": False, "error": "Message not found"}

            # Only the recipient (not the sender) can mark as read
            if str(msg.sender_id) == reader_id:
                return {"ok": False, "error": "Cannot mark your own message as read"}

            if msg.read_by_recipient:
                # Already read, no-op
                return {"ok": True, "already_read": True}

            msg.read_by_recipient = True
            msg.read_at = now
            await db.commit()

    except Exception:
        logger.exception("Failed to update read receipt for message=%s", message_id)
        return {"ok": False, "error": "Failed to update read receipt"}

    read_at_iso = now.isoformat()

    # Broadcast to the job room
    await broadcast_to_job(
        job_id,
        "chat:message_read",
        {
            "job_id": job_id,
            "message_id": message_id,
            "read_by": reader_id,
            "read_at": read_at_iso,
        },
        namespace="/chat",
    )

    logger.info("Read receipt: message=%s read_by=%s job=%s", message_id, reader_id, job_id)
    return {"ok": True, "read_at": read_at_iso}
