"""
Pydantic v2 schemas for the service taxonomy API (categories and tasks).

These models define the public API contract.  They deliberately expose only
the fields that mobile and dashboard clients need, keeping internal columns
(e.g. ``escalation_keywords``) out of default list responses for efficiency.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------

class PaginationMeta(BaseModel):
    """Pagination metadata included in every paginated response."""

    page: int = Field(ge=1, description="Current page number (1-indexed)")
    page_size: int = Field(ge=1, description="Number of items per page")
    total_items: int = Field(ge=0, description="Total number of matching items")
    total_pages: int = Field(ge=0, description="Total number of pages")


# ---------------------------------------------------------------------------
# Category schemas
# ---------------------------------------------------------------------------

class CategoryBrief(BaseModel):
    """Minimal category representation used in nested contexts."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    icon_url: Optional[str] = None


class CategoryOut(BaseModel):
    """Full category representation returned by list and detail endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: Optional[str] = None
    icon_url: Optional[str] = None
    display_order: int
    is_active: bool
    parent_id: Optional[uuid.UUID] = None
    task_count: int = Field(
        default=0,
        description="Number of active tasks in this category",
    )
    created_at: datetime
    updated_at: datetime


class CategoryListResponse(BaseModel):
    """Paginated list of categories."""

    data: list[CategoryOut]
    meta: PaginationMeta


# ---------------------------------------------------------------------------
# Task schemas
# ---------------------------------------------------------------------------

class TaskBrief(BaseModel):
    """Compact task representation used in list / search results."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: Optional[str] = None
    level: str = Field(description="Required provider level (1-4)")
    category_id: uuid.UUID
    emergency_eligible: bool
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None
    icon_url: Optional[str] = None
    display_order: int
    is_active: bool


class TaskDetail(BaseModel):
    """Full task detail including regulatory flags and escalation keywords."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    name: str
    description: Optional[str] = None
    level: str = Field(description="Required provider level (1-4)")
    category: CategoryBrief

    # Regulatory / safety flags
    regulated: bool
    license_required: bool
    hazardous: bool
    structural: bool
    emergency_eligible: bool

    # Pricing guidance
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None

    # Auto-escalation
    escalation_keywords: list[str] = Field(default_factory=list)

    # Display
    icon_url: Optional[str] = None
    display_order: int
    is_active: bool

    # Timestamps
    created_at: datetime
    updated_at: datetime


class TaskListResponse(BaseModel):
    """Paginated list of tasks (used for category task listing)."""

    data: list[TaskBrief]
    meta: PaginationMeta


class TaskSearchResponse(BaseModel):
    """Paginated search results for tasks."""

    data: list[TaskBrief]
    meta: PaginationMeta
    query: str = Field(description="The search query that was executed")


class TaskClassification(BaseModel):
    """Result of the automated task classification algorithm.

    This schema is used internally and can also be exposed via admin
    endpoints for debugging classification logic.
    """

    recommended_level: str = Field(
        description="The level assigned by the classification algorithm (1-4)"
    )
    reason: str = Field(
        description="Human-readable explanation of why this level was assigned"
    )
    flags: list[str] = Field(
        default_factory=list,
        description="List of flags that influenced the classification",
    )


class TimeSlot(BaseModel):
    """Available time slot for a task."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    start_time: str = Field(alias="startTime")
    end_time: str = Field(alias="endTime")
    available: bool
