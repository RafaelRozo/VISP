"""Denuncias, bloqueos y acciones del admin (migración 055).

Apple, guía 1.2. La lógica vive en `services/moderation_service.py`; ver
`docs/plan-denunciar-bloquear.md`.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ContentReport(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "content_reports"

    # NULL solo si la creó el filtro automático del chat.
    reporter_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    reported_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    # USER | AUTO_FILTER
    source: Mapped[str] = mapped_column(String(20), nullable=False, server_default="USER")
    # USER | CHAT_MESSAGE | JOB_DETAILS | JOB_EVIDENCE | PROFILE
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)
    content_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    # HARASSMENT | OFFENSIVE | INAPPROPRIATE_PHOTO | SCAM | SAFETY | OTHER
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Copia del contenido al denunciar: la prueba no depende de que siga existiendo.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    # OPEN | ACTIONED | DISMISSED
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default="OPEN")
    # dismiss | remove_content | suspend | ban
    admin_action: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    admin_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ContentReport({self.content_type}, {self.reason}, {self.status})>"


class UserBlock(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Un bloqueo. El efecto es en las dos direcciones; la fila guarda quién lo pidió."""

    __tablename__ = "user_blocks"

    blocker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    blocked_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    job_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="SET NULL"), nullable=True
    )
    # PANIC | MENU | REPORT
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    cancellation_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("job_cancellation_reports.id", ondelete="SET NULL"),
        nullable=True,
    )
    content_report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_reports.id", ondelete="SET NULL"), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<UserBlock({self.blocker_id} -> {self.blocked_id}, {self.source})>"


class ModerationAction(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "moderation_actions"

    admin_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    action: Mapped[str] = mapped_column(String(30), nullable=False)
    report_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("content_reports.id", ondelete="SET NULL"), nullable=True
    )
    target_user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    block_snapshot: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    note: Mapped[str] = mapped_column(Text, nullable=False)

    def __repr__(self) -> str:  # pragma: no cover
        return f"<ModerationAction({self.action}, admin={self.admin_id})>"
