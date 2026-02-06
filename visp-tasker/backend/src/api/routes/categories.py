"""
Category API routes -- VISP-BE-TAXONOMY-001
=============================================

Endpoints for browsing the service category catalog.

Routes:
  GET /api/v1/categories                       -- paginated list of categories
  GET /api/v1/categories/{category_id}/tasks   -- tasks in a category (filterable by level)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import DBSession
from src.api.schemas.taxonomy import (
    CategoryListResponse,
    CategoryOut,
    PaginationMeta,
    TaskBrief,
    TaskListResponse,
)
from src.core.config import settings
from src.services import taxonomy_service

router = APIRouter(prefix="/categories", tags=["Categories"])


# ---------------------------------------------------------------------------
# GET /api/v1/categories
# ---------------------------------------------------------------------------

@router.get(
    "",
    response_model=CategoryListResponse,
    summary="List all active service categories",
    description=(
        "Returns a paginated list of active service categories ordered by "
        "display_order.  Each category includes a count of its active tasks."
    ),
)
async def list_categories(
    db: DBSession,
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> CategoryListResponse:
    result = await taxonomy_service.list_categories(
        db,
        page=page,
        page_size=page_size,
    )

    return CategoryListResponse(
        data=[CategoryOut.model_validate(cat) for cat in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/categories/{category_id}/tasks
# ---------------------------------------------------------------------------

@router.get(
    "/{category_id}/tasks",
    response_model=TaskListResponse,
    summary="List tasks for a category",
    description=(
        "Returns a paginated list of active tasks belonging to the specified "
        "category.  Optionally filter by provider level (1-4)."
    ),
)
async def list_category_tasks(
    db: DBSession,
    category_id: uuid.UUID,
    level: str | None = Query(
        default=None,
        pattern=r"^[1-4]$",
        description="Filter by provider level (1, 2, 3, or 4)",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> TaskListResponse:
    # Verify category exists
    category = await taxonomy_service.get_category_by_id(db, category_id)
    if category is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Category with id '{category_id}' not found.",
        )

    try:
        result = await taxonomy_service.list_tasks_for_category(
            db,
            category_id,
            level=level,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return TaskListResponse(
        data=[TaskBrief.model_validate(task) for task in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )
