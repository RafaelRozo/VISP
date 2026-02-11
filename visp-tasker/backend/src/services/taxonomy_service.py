"""
Taxonomy Service -- VISP-BE-TAXONOMY-001
=========================================

Business logic for the closed task catalog.  All queries use async
SQLAlchemy sessions and return ORM instances (or counts) that the route
layer converts to Pydantic schemas.

Key responsibilities:
  - List / paginate service categories
  - List / filter tasks by category and level
  - Retrieve a single task by ID
  - Keyword search across task names and descriptions
  - Automated task classification based on regulatory flags
  - Level validation
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from typing import Optional, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.provider import ProviderLevel
from src.models.taxonomy import ServiceCategory, ServiceTask


# ---------------------------------------------------------------------------
# Classification result (internal data class)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ClassificationResult:
    """Immutable result of the task classification algorithm."""

    recommended_level: ProviderLevel
    reason: str
    flags: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pagination helper
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PaginatedResult:
    """Generic container for a page of results plus metadata."""

    items: Sequence
    total_items: int
    page: int
    page_size: int

    @property
    def total_pages(self) -> int:
        if self.total_items == 0:
            return 0
        return math.ceil(self.total_items / self.page_size)


# ---------------------------------------------------------------------------
# Level validation
# ---------------------------------------------------------------------------

VALID_LEVELS = frozenset(level.value for level in ProviderLevel)


def validate_level(level: str) -> ProviderLevel:
    """Validate and convert a string level value to a ``ProviderLevel`` enum.

    Raises ``ValueError`` if the level is not one of 1, 2, 3, 4.
    """
    if level not in VALID_LEVELS:
        raise ValueError(
            f"Invalid level '{level}'. Must be one of: {', '.join(sorted(VALID_LEVELS))}"
        )
    return ProviderLevel(level)


# ---------------------------------------------------------------------------
# Task classification algorithm
# ---------------------------------------------------------------------------

def classify_task(
    *,
    regulated: bool = False,
    license_required: bool = False,
    hazardous: bool = False,
    structural: bool = False,
    emergency_eligible: bool = False,
    requires_experience: bool = False,
) -> ClassificationResult:
    """Determine the appropriate provider level for a task based on its
    regulatory and safety attributes.

    Classification rules (applied in priority order):

    1. If ``regulated`` OR ``license_required`` AND ``emergency_eligible``
       --> Level 4 (Emergency).
    2. If ``regulated`` OR ``license_required``
       --> Level 3 (Certified Pro).
    3. If ``hazardous`` OR ``structural``
       --> Level 3 (Certified Pro).
    4. If ``requires_experience``
       --> Level 2 (Experienced).
    5. Default
       --> Level 1 (Helper).
    """
    flags: list[str] = []

    if regulated:
        flags.append("regulated")
    if license_required:
        flags.append("license_required")
    if hazardous:
        flags.append("hazardous")
    if structural:
        flags.append("structural")
    if emergency_eligible:
        flags.append("emergency_eligible")
    if requires_experience:
        flags.append("requires_experience")

    # Rule 1: Regulated/licensed + emergency eligible --> Level 4
    if (regulated or license_required) and emergency_eligible:
        return ClassificationResult(
            recommended_level=ProviderLevel.LEVEL_4,
            reason=(
                "Task requires regulatory licensing and is emergency-eligible. "
                "Assigned to Level 4 (Emergency) for SLA-bound 24/7 on-call providers."
            ),
            flags=flags,
        )

    # Rule 2: Regulated or license required --> Level 3
    if regulated or license_required:
        return ClassificationResult(
            recommended_level=ProviderLevel.LEVEL_3,
            reason=(
                "Task requires regulatory licensing or is regulated. "
                "Assigned to Level 3 (Certified Pro) requiring valid license and insurance."
            ),
            flags=flags,
        )

    # Rule 3: Hazardous or structural --> Level 3
    if hazardous or structural:
        return ClassificationResult(
            recommended_level=ProviderLevel.LEVEL_3,
            reason=(
                "Task involves hazardous materials or structural work. "
                "Assigned to Level 3 (Certified Pro) for certified professionals."
            ),
            flags=flags,
        )

    # Rule 4: Requires experience --> Level 2
    if requires_experience:
        return ClassificationResult(
            recommended_level=ProviderLevel.LEVEL_2,
            reason=(
                "Task requires technical experience or a portfolio. "
                "Assigned to Level 2 (Experienced)."
            ),
            flags=flags,
        )

    # Rule 5: Default --> Level 1
    return ClassificationResult(
        recommended_level=ProviderLevel.LEVEL_1,
        reason="Standard task with no special requirements. Assigned to Level 1 (Helper).",
        flags=flags,
    )


# ---------------------------------------------------------------------------
# Category queries
# ---------------------------------------------------------------------------

async def list_categories(
    db: AsyncSession,
    *,
    page: int = 1,
    page_size: int = 20,
    include_inactive: bool = False,
) -> PaginatedResult:
    """Return a paginated list of service categories ordered by
    ``display_order``.

    Each category includes a ``task_count`` attribute indicating the number
    of *active* tasks it contains.
    """
    # Base filter
    filters = []
    if not include_inactive:
        filters.append(ServiceCategory.is_active.is_(True))

    # Count query
    count_stmt = select(func.count(ServiceCategory.id)).where(*filters)
    total_items: int = (await db.execute(count_stmt)).scalar_one()

    # Data query -- with active task count as a correlated subquery
    active_task_count = (
        select(func.count(ServiceTask.id))
        .where(
            and_(
                ServiceTask.category_id == ServiceCategory.id,
                ServiceTask.is_active.is_(True),
            )
        )
        .correlate(ServiceCategory)
        .scalar_subquery()
        .label("task_count")
    )

    data_stmt = (
        select(ServiceCategory, active_task_count)
        .where(*filters)
        .order_by(ServiceCategory.display_order, ServiceCategory.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await db.execute(data_stmt)).all()

    # Attach the computed task_count to each ORM object so ``from_attributes``
    # can pick it up in the Pydantic schema.
    categories = []
    for row in rows:
        category = row[0]  # ServiceCategory ORM instance
        category.task_count = row[1] or 0  # type: ignore[attr-defined]
        categories.append(category)

    return PaginatedResult(
        items=categories,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


async def get_category_by_id(
    db: AsyncSession,
    category_id: uuid.UUID,
) -> Optional[ServiceCategory]:
    """Fetch a single category by primary key, or ``None`` if not found."""
    stmt = select(ServiceCategory).where(ServiceCategory.id == category_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Task queries
# ---------------------------------------------------------------------------

async def list_tasks_for_category(
    db: AsyncSession,
    category_id: uuid.UUID,
    *,
    level: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    include_inactive: bool = False,
) -> PaginatedResult:
    """Return a paginated list of tasks belonging to a category.

    Optionally filtered by provider level.
    """
    filters = [ServiceTask.category_id == category_id]
    if not include_inactive:
        filters.append(ServiceTask.is_active.is_(True))
    if level is not None:
        validated_level = validate_level(level)
        filters.append(ServiceTask.level == validated_level)

    # Count
    count_stmt = select(func.count(ServiceTask.id)).where(*filters)
    total_items: int = (await db.execute(count_stmt)).scalar_one()

    # Data
    data_stmt = (
        select(ServiceTask)
        .where(*filters)
        .order_by(ServiceTask.display_order, ServiceTask.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    tasks = (await db.execute(data_stmt)).scalars().all()

    return PaginatedResult(
        items=tasks,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


async def get_task_by_id(
    db: AsyncSession,
    task_id: uuid.UUID,
) -> Optional[ServiceTask]:
    """Fetch a single task by primary key with its parent category eagerly
    loaded, or ``None`` if not found."""
    stmt = (
        select(ServiceTask)
        .options(selectinload(ServiceTask.category))
        .where(ServiceTask.id == task_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def search_tasks(
    db: AsyncSession,
    *,
    query: str,
    level: Optional[str] = None,
    category_id: Optional[uuid.UUID] = None,
    page: int = 1,
    page_size: int = 20,
    include_inactive: bool = False,
) -> PaginatedResult:
    """Search tasks by keyword matching against name and description.

    Uses case-insensitive ``ILIKE`` for portability.  For production at
    scale this should be backed by Elasticsearch / ``pg_trgm``, but the
    SQL approach is correct and sufficient for initial deployment.

    The search term is split into individual words, and ALL words must
    appear somewhere in the task name or description (AND semantics).
    """
    words = query.strip().split()
    if not words:
        return PaginatedResult(items=[], total_items=0, page=page, page_size=page_size)

    filters: list = []
    if not include_inactive:
        filters.append(ServiceTask.is_active.is_(True))
    if level is not None:
        validated_level = validate_level(level)
        filters.append(ServiceTask.level == validated_level)
    if category_id is not None:
        filters.append(ServiceTask.category_id == category_id)

    # Each word must appear in name OR description
    for word in words:
        pattern = f"%{word}%"
        filters.append(
            or_(
                ServiceTask.name.ilike(pattern),
                ServiceTask.description.ilike(pattern),
            )
        )

    # Count
    count_stmt = select(func.count(ServiceTask.id)).where(*filters)
    total_items: int = (await db.execute(count_stmt)).scalar_one()

    # Data
    data_stmt = (
        select(ServiceTask)
        .where(*filters)
        .order_by(ServiceTask.display_order, ServiceTask.name)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    tasks = (await db.execute(data_stmt)).scalars().all()

    return PaginatedResult(
        items=tasks,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


async def get_time_slots(
    db: AsyncSession,
    task_id: uuid.UUID,
    date_str: str,
) -> list[dict]:
    """Generate available time slots for a given task and date.

    Currently returns standard business hours (08:00 - 20:00).
    Future evolution: Query `provider_availability` and `provider_task_qualifications`
    to return only slots where at least one qualified provider is available.
    """
    slots = []
    # Standard 8 AM to 8 PM schedule
    for hour in range(8, 20):
        start = f"{hour:02d}:00"
        end = f"{hour + 1:02d}:00"

        # Format label (e.g., "9:00 AM")
        h = hour % 12 or 12
        ampm = "AM" if hour < 12 else "PM"
        label = f"{h}:00 {ampm}"

        slots.append({
            "id": start,
            "label": label,
            "startTime": start,
            "endTime": end,
            "available": True,  # Assume available for now
        })

    return slots
