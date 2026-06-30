"""
SQLAlchemy model for the `superusers` table.

Superusers are completely separate from regular `users`:
- different table
- different JWT secret (ADMIN_JWT_SECRET)
- different login route (/api/v1/admin/auth/login)

This separation limits blast radius if a regular user JWT is leaked.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class SuperUser(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "superusers"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="admin")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
