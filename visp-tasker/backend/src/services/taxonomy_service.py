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
import re
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


# Filler words stripped from a search query before matching. Service verbs
# (clean, fix, repair, install, mow, paint, mount, walk, ...) are intentionally
# NOT here — they carry meaning.
_SEARCH_STOPWORDS = {
    "i", "im", "ive", "id", "a", "an", "the", "to", "my", "me", "mine", "of",
    "and", "or", "for", "with", "in", "on", "at", "is", "are", "be", "it",
    "that", "this", "need", "needs", "needed", "want", "wants", "wanna",
    "would", "like", "please", "pls", "plz", "help", "some", "any", "can",
    "could", "do", "does", "have", "has", "having", "get", "got", "there",
    "got", "someone", "somebody", "looking", "look",
}

_TOKEN_RE = re.compile(r"[^a-z0-9]+")


def _tokenize(text: str | None) -> list[str]:
    """Lowercase + split on non-alphanumerics into word tokens."""
    if not text:
        return []
    return [tok for tok in _TOKEN_RE.split(text.lower()) if tok]


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
    """Natural-language-ish keyword search over the CLOSED task catalog.

    Tokenizes the query, drops filler words ("I need to", "my", ...), then
    scores every active task by token overlap against its name (high), curated
    ``search_aliases`` (high), ``escalation_keywords`` (medium) and description
    (low). Returns the best matches ranked by score. The catalog is small
    (~218 rows) so scoring in Python is cheap and far more flexible than the
    old ALL-words-must-appear ``ILIKE``. Never returns free text — only
    predefined tasks (closed-catalog rule preserved).
    """
    raw_tokens = _tokenize(query)
    query_tokens = [t for t in raw_tokens if t not in _SEARCH_STOPWORDS and len(t) >= 2]
    if not query_tokens:
        # Query was only filler/very short — fall back to whatever has length.
        query_tokens = [t for t in raw_tokens if len(t) >= 2]
    if not query_tokens:
        return PaginatedResult(items=[], total_items=0, page=page, page_size=page_size)

    filters: list = []
    if not include_inactive:
        filters.append(ServiceTask.is_active.is_(True))
    if level is not None:
        filters.append(ServiceTask.level == validate_level(level))
    if category_id is not None:
        filters.append(ServiceTask.category_id == category_id)

    candidates = (await db.execute(select(ServiceTask).where(*filters))).scalars().all()
    query_join = " ".join(query_tokens)

    scored: list[tuple[int, ServiceTask]] = []
    for task in candidates:
        name_toks = set(_tokenize(task.name))
        desc_toks = set(_tokenize(task.description))

        alias_list = task.search_aliases if isinstance(task.search_aliases, list) else []
        alias_phrases = [str(a).lower().strip() for a in alias_list]
        alias_toks: set[str] = set()
        for phrase in alias_phrases:
            alias_toks.update(_tokenize(phrase))

        kw_list = task.escalation_keywords if isinstance(task.escalation_keywords, list) else []
        kw_toks: set[str] = set()
        for kw in kw_list:
            kw_toks.update(_tokenize(str(kw)))

        score = 0
        for word in query_tokens:
            if word in name_toks:
                score += 3
            elif len(word) >= 3 and any(word in nt for nt in name_toks):
                score += 1  # partial (e.g. "ac" inside "hvac")
            if word in alias_toks:
                score += 3
            if word in kw_toks:
                score += 2
            if word in desc_toks:
                score += 1

        # A full multi-word alias appearing in the query is a strong signal.
        for phrase in alias_phrases:
            if " " in phrase and phrase in query_join:
                score += 4

        if score > 0:
            scored.append((score, task))

    scored.sort(key=lambda pair: (-pair[0], pair[1].display_order, pair[1].name))
    total_items = len(scored)
    start = (page - 1) * page_size
    page_items = [task for _, task in scored[start : start + page_size]]

    return PaginatedResult(
        items=page_items,
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

    Horario estándar 08:00-20:00. Las horas YA PASADAS del día de hoy salen como no
    disponibles (2026-08-20): antes se devolvían todas con `available: True` sin
    mirar el reloj, y un cliente que reservaba a las 15:36 podía elegir la 1 PM del
    mismo día. El trabajo nacía con la hora pedida en el pasado — imposible de
    cumplir— y la app lo pintaba como caducado nada más crearlo.

    La hora se compara en **America/Toronto**, no en UTC. El servidor corre en UTC y
    Ontario va 4-5 horas por detrás: filtrar por la hora UTC borraría media jornada
    de golpe. Cuando VISP abra zonas en otros husos, esto tiene que salir de la zona
    de servicio del cliente, no de una constante.

    Evolución futura: consultar `provider_availability` y
    `provider_task_qualifications` para devolver solo las horas con algún proveedor
    calificado disponible.
    """
    from datetime import date as _date, datetime as _dt
    from zoneinfo import ZoneInfo

    _TZ_SERVICIO = ZoneInfo("America/Toronto")
    ahora = _dt.now(_TZ_SERVICIO)

    try:
        dia = _date.fromisoformat(date_str)
    except (TypeError, ValueError):
        # Fecha ilegible: se devuelve el día entero en vez de reventar. La reserva
        # se valida igualmente en el backend.
        dia = None

    es_hoy = dia == ahora.date()

    slots = []
    # Standard 8 AM to 8 PM schedule
    for hour in range(8, 20):
        start = f"{hour:02d}:00"
        end = f"{hour + 1:02d}:00"

        # Format label (e.g., "9:00 AM")
        h = hour % 12 or 12
        ampm = "AM" if hour < 12 else "PM"
        label = f"{h}:00 {ampm}"

        # La hora en curso también se descarta: si son las 15:36, "3:00 PM" ya
        # empezó y nadie puede llegar a tiempo.
        pasada = es_hoy and hour <= ahora.hour

        slots.append({
            "id": start,
            "label": label,
            "startTime": start,
            "endTime": end,
            "available": not pasada,
        })

    return slots


async def get_full_active_taxonomy(db: AsyncSession) -> list[ServiceCategory]:
    """Fetch the full hierarchy of active categories and their active tasks.

    Used by the Provider App for service selection during onboarding.
    Optimization: Fetches everything in one go using selectinload or joinedload,
    but since we need to filter *tasks* by is_active, clear separation is safer.
    """
    # 1. Fetch all active categories
    cat_stmt = (
        select(ServiceCategory)
        .where(ServiceCategory.is_active.is_(True))
        .order_by(ServiceCategory.display_order, ServiceCategory.name)
    )
    categories = (await db.execute(cat_stmt)).scalars().all()

    # 2. Fetch all active tasks
    task_stmt = (
        select(ServiceTask)
        .where(ServiceTask.is_active.is_(True))
        .order_by(ServiceTask.display_order, ServiceTask.name)
    )
    tasks = (await db.execute(task_stmt)).scalars().all()

    # 3. Group tasks by category_id
    tasks_by_cat = {}
    for task in tasks:
        if task.category_id not in tasks_by_cat:
            tasks_by_cat[task.category_id] = []
        tasks_by_cat[task.category_id].append(task)

    # 4. Attach tasks to categories (ephemeral attribute for Pydantic)
    result = []
    for cat in categories:
        # Create a clean list of tasks for this category
        cat_tasks = tasks_by_cat.get(cat.id, [])
        # We attach it to the ORM instance. The Schema must expect 'tasks'
        cat.active_tasks_list = cat_tasks
        result.append(cat)

    return result
