"""
Task API routes -- VISP-BE-TAXONOMY-001
========================================

Endpoints for retrieving and searching within the closed task catalog.

Routes:
  GET /api/v1/tasks/{task_id}   -- retrieve a single task with full detail
  GET /api/v1/tasks/search      -- keyword search across all tasks
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import DBSession
from src.api.schemas.taxonomy import (
    PaginationMeta,
    TaskBrief,
    TaskDetail,
    TaskSearchResponse,
    TimeSlot,
)
from src.core.config import settings
from src.services import taxonomy_service

router = APIRouter(prefix="/tasks", tags=["Tasks"])


# ---------------------------------------------------------------------------
# GET /api/v1/tasks/search
# ---------------------------------------------------------------------------
# IMPORTANT: This route MUST be defined before the /{task_id} route so
# that FastAPI does not interpret "search" as a UUID path parameter.
# ---------------------------------------------------------------------------

@router.get(
    "/search",
    response_model=TaskSearchResponse,
    summary="Search tasks by keyword",
    description=(
        "Performs a keyword search across task names and descriptions.  "
        "All search terms must appear in either the name or description "
        "(AND semantics).  Results can be filtered by provider level and/or "
        "category."
    ),
)
async def search_tasks(
    db: DBSession,
    q: str = Query(
        ...,
        min_length=1,
        max_length=200,
        description="Search query (required, 1-200 characters)",
    ),
    level: str | None = Query(
        default=None,
        pattern=r"^[1-4]$",
        description="Filter by provider level (1, 2, 3, or 4)",
    ),
    category_id: uuid.UUID | None = Query(
        default=None,
        description="Filter by category UUID",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> TaskSearchResponse:
    try:
        result = await taxonomy_service.search_tasks(
            db,
            query=q,
            level=level,
            category_id=category_id,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return TaskSearchResponse(
        data=[TaskBrief.model_validate(task) for task in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
        query=q,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/tasks/{task_id}
# ---------------------------------------------------------------------------

@router.get(
    "/{task_id}",
    response_model=TaskDetail,
    summary="Get task detail",
    description=(
        "Returns the full detail for a single task, including all regulatory "
        "flags, escalation keywords, pricing guidance, and the parent category."
    ),
)
async def get_task(
    db: DBSession,
    task_id: uuid.UUID,
) -> TaskDetail:
    task = await taxonomy_service.get_task_by_id(db, task_id)
    if task is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task with id '{task_id}' not found.",
        )

    return TaskDetail.model_validate(task)


# ---------------------------------------------------------------------------
# GET /api/v1/tasks/{task_id}/time-slots -- Get available time slots
# ---------------------------------------------------------------------------

@router.get(
    "/{task_id}/time-slots",
    response_model=list[TimeSlot],
    summary="Get available time slots",
    description=(
        "Returns a list of available time slots for a specific task and date. "
        "Currently returns standard business hours availability."
    ),
)
async def get_task_time_slots(
    db: DBSession,
    task_id: uuid.UUID,
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
) -> list[TimeSlot]:
    slots = await taxonomy_service.get_time_slots(db, task_id, date)
    return [TimeSlot.model_validate(slot) for slot in slots]
