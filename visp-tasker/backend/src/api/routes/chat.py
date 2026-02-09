"""
Chat API Routes -- VISP-INT-REALTIME-004
==========================================

REST endpoints for in-app chat between customer and provider during
active jobs.  These complement the WebSocket real-time handlers in
``src/realtime/handlers/chatHandler.py``.

Routes:
  GET    /api/v1/jobs/{job_id}/messages              -- Chat history (paginated)
  POST   /api/v1/jobs/{job_id}/messages              -- Send a message
  PATCH  /api/v1/jobs/{job_id}/messages/read          -- Mark all as read
  GET    /api/v1/jobs/{job_id}/messages/unread-count  -- Unread count

All endpoints require a valid Bearer token in the Authorization header.
The requesting user must be either the customer or the assigned provider
for the given job.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.chat import (
    ChatHistoryData,
    ChatHistoryResponse,
    ChatMessageOut,
    MarkReadResponse,
    PaginationMeta,
    SendMessageRequest,
    SendMessageResponse,
    UnreadCountData,
    UnreadCountResponse,
)
from src.services import chatService

router = APIRouter(prefix="/jobs", tags=["Chat"])


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id}/messages -- Chat history
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/messages",
    response_model=ChatHistoryResponse,
    summary="Get chat history for a job",
    description=(
        "Returns a paginated list of chat messages for a job. Messages are "
        "ordered chronologically (oldest first). The requesting user must be "
        "either the customer or the assigned provider for this job."
    ),
)
async def get_messages(
    db: DBSession,
    current_user: CurrentUser,
    job_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=50,
        ge=1,
        le=100,
        alias="pageSize",
        description="Number of messages per page (max 100)",
    ),
    before: Optional[datetime] = Query(
        default=None,
        description="Only return messages created before this ISO timestamp",
    ),
) -> ChatHistoryResponse:
    try:
        result = await chatService.get_messages(
            db,
            job_id=job_id,
            user_id=current_user.id,
            page=page,
            page_size=page_size,
            before=before,
        )
    except chatService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except chatService.NotParticipantError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        )

    items = [
        ChatMessageOut(
            id=msg.id,
            job_id=msg.job_id,
            sender_id=msg.sender_id,
            sender_name=msg.sender_name,
            message=msg.message,
            message_type=msg.message_type,
            read_at=msg.read_at,
            created_at=msg.created_at,
        )
        for msg in result.items
    ]

    return ChatHistoryResponse(
        data=ChatHistoryData(
            items=items,
            meta=PaginationMeta(
                page=result.page,
                page_size=result.page_size,
                total_items=result.total_items,
                total_pages=result.total_pages,
            ),
        ),
    )


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/messages -- Send a message
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/messages",
    response_model=SendMessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Send a chat message",
    description=(
        "Sends a new chat message in the context of a job. The job must be in "
        "an active status (matched through completed). The message is also "
        "broadcast in real-time via WebSocket to the other participant."
    ),
)
async def send_message(
    db: DBSession,
    current_user: CurrentUser,
    job_id: uuid.UUID,
    body: SendMessageRequest,
) -> SendMessageResponse:
    try:
        msg = await chatService.send_message(
            db,
            job_id=job_id,
            sender_id=current_user.id,
            message_text=body.message,
            message_type_str=body.message_type or "text",
        )
    except chatService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except chatService.ChatNotAllowedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )
    except chatService.NotParticipantError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    # Best-effort: broadcast via WebSocket to the job room
    try:
        from src.realtime.socketServer import broadcast_to_job

        await broadcast_to_job(
            str(job_id),
            "chat:new_message",
            {
                "messageId": str(msg.id),
                "jobId": str(msg.job_id),
                "senderId": str(msg.sender_id),
                "senderName": msg.sender_name,
                "message": msg.message,
                "messageType": msg.message_type,
                "createdAt": msg.created_at.isoformat() if msg.created_at else None,
            },
            namespace="/chat",
        )
    except Exception:
        # WebSocket broadcast is best-effort; the REST response is the
        # source of truth.  Log but do not fail the request.
        import logging
        logging.getLogger(__name__).warning(
            "Failed to broadcast chat:new_message via WebSocket for job=%s",
            job_id,
            exc_info=True,
        )

    return SendMessageResponse(
        data=ChatMessageOut(
            id=msg.id,
            job_id=msg.job_id,
            sender_id=msg.sender_id,
            sender_name=msg.sender_name,
            message=msg.message,
            message_type=msg.message_type,
            read_at=msg.read_at,
            created_at=msg.created_at,
        ),
    )


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/messages/read -- Mark all as read
# ---------------------------------------------------------------------------

@router.patch(
    "/{job_id}/messages/read",
    response_model=MarkReadResponse,
    summary="Mark all messages as read",
    description=(
        "Marks all unread messages in the job chat as read for the current "
        "user.  Only messages sent by the other participant are affected."
    ),
)
async def mark_messages_read(
    db: DBSession,
    current_user: CurrentUser,
    job_id: uuid.UUID,
) -> MarkReadResponse:
    try:
        updated = await chatService.mark_messages_read(
            db,
            job_id=job_id,
            reader_id=current_user.id,
        )
    except chatService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except chatService.NotParticipantError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        )

    # Best-effort: broadcast read receipt via WebSocket
    if updated > 0:
        try:
            from src.realtime.socketServer import broadcast_to_job

            await broadcast_to_job(
                str(job_id),
                "chat:messages_read",
                {
                    "jobId": str(job_id),
                    "readBy": str(current_user.id),
                    "count": updated,
                },
                namespace="/chat",
            )
        except Exception:
            pass

    return MarkReadResponse(
        data=None,
        message=f"Messages marked as read ({updated} updated)",
    )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id}/messages/unread-count -- Unread count
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/messages/unread-count",
    response_model=UnreadCountResponse,
    summary="Get unread message count",
    description=(
        "Returns the number of unread messages in the job chat for the "
        "current user.  Only counts messages from the other participant."
    ),
)
async def get_unread_count(
    db: DBSession,
    current_user: CurrentUser,
    job_id: uuid.UUID,
) -> UnreadCountResponse:
    try:
        count = await chatService.get_unread_count(
            db,
            job_id=job_id,
            user_id=current_user.id,
        )
    except chatService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except chatService.NotParticipantError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        )

    return UnreadCountResponse(
        data=UnreadCountData(count=count),
    )
