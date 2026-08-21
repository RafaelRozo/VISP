"""
Pydantic v2 schemas for the service taxonomy API (categories and tasks).

These models define the public API contract.  They deliberately expose only
the fields that mobile and dashboard clients need, keeping internal columns
(e.g. ``escalation_keywords``) out of default list responses for efficiency.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

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
    # La unidad viaja también en el LISTADO, no solo en el detalle: sin ella la
    # lista solo puede enseñar "desde $45", que no dice si son 45 por hora, por
    # mueble o por el trabajo entero — y es justo lo que el cliente compara.
    pricing_unit: Optional[str] = None
    icon_url: Optional[str] = None
    display_order: int
    is_active: bool


class TaskQuestionOut(BaseModel):
    """Pregunta que el cliente responde al reservar."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    question_en: str
    question_fr: Optional[str] = None
    # 'TEXT' -> textarea libre. 'SINGLE_CHOICE' -> el cliente elige de `options`.
    # 'IMAGE' -> la respuesta es una foto y `answer` lleva su URL (migración 043).
    answer_type: str = "TEXT"
    options: list[dict[str, Any]] = Field(default_factory=list)
    is_required: bool = True
    display_order: int = 0
    # Solo se muestra —y solo se exige— si el cliente pide material.
    materials_only: bool = False


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

    # Charge unit + quantity (PP4a/PP5 — drives the booking quantity picker)
    pricing_unit: Optional[str] = None
    allows_quantity: bool = False
    min_quantity: Optional[float] = None

    # Auto-escalation
    escalation_keywords: list[str] = Field(default_factory=list)

    # Qué debe aportar el CLIENTE al reservar (migración 038). La app los necesita
    # para saber si puede seguir sin detalles/foto y qué prompt mostrar; sin ellos
    # tendría que adivinar y el rechazo llegaría del backend al final del flujo,
    # cuando el usuario ya invirtió todo el recorrido.
    requires_details: bool = False
    requires_evidence: bool = False
    details_prompt_en: Optional[str] = None
    details_prompt_fr: Optional[str] = None
    # Preguntas activas del servicio (migración 039). La app las pinta como
    # textareas; las obligatorias bloquean la reserva si van vacías.
    questions: list["TaskQuestionOut"] = Field(default_factory=list)

    # Materiales (migración 043). La app necesita saber si puede ofrecer la pregunta
    # de "¿quieres que compre los materiales?" y entre qué importes puede moverse el
    # presupuesto; sin esto tendría que adivinarlo y el rechazo llegaría del backend
    # al final del recorrido.
    materials_enabled: bool = False
    materials_budget_min_cents: Optional[int] = None
    materials_budget_max_cents: Optional[int] = None
    materials_note_en: Optional[str] = None
    materials_note_fr: Optional[str] = None

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
