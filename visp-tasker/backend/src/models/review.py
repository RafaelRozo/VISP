"""
SQLAlchemy models for reviews, review_dimensions, and review_dimension_scores.
Corresponds to migration 008_create_reviews.sql.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ReviewStatus(str, enum.Enum):
    PENDING = "pending"
    PUBLISHED = "published"
    HIDDEN = "hidden"
    FLAGGED = "flagged"
    REMOVED = "removed"


class ReviewerRole(str, enum.Enum):
    CUSTOMER = "customer"
    PROVIDER = "provider"


class Review(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reviews"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Who is reviewing whom
    reviewer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reviewee_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    reviewer_role: Mapped[ReviewerRole] = mapped_column(
        Enum(ReviewerRole, name="reviewer_role", create_type=False),
        nullable=False,
    )

    # Overall rating (1-5, stored as numeric for weighted averaging)
    overall_rating: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False)

    # Weighted composite score (calculated from dimensions)
    weighted_score: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )

    # Free text (moderated)
    comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status
    status: Mapped[ReviewStatus] = mapped_column(
        Enum(ReviewStatus, name="review_status", create_type=False),
        nullable=False,
        server_default="PENDING",
    )
    moderated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    moderated_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    moderation_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Provider response
    response_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    response_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="reviews")
    reviewer: Mapped["User"] = relationship(
        "User", back_populates="reviews_given", foreign_keys=[reviewer_id]
    )
    reviewee: Mapped["User"] = relationship(
        "User", back_populates="reviews_received", foreign_keys=[reviewee_id]
    )
    moderator: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[moderated_by]
    )
    dimension_scores: Mapped[list["ReviewDimensionScore"]] = relationship(
        "ReviewDimensionScore", back_populates="review", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<Review(id={self.id}, job={self.job_id}, "
            f"rating={self.overall_rating}, status={self.status})>"
        )


class ReviewDimension(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "review_dimensions"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Weight for composite scoring (all weights should sum to 1.0 per role)
    weight: Mapped[Decimal] = mapped_column(Numeric(4, 3), nullable=False)

    # Which reviewer role uses this dimension
    applicable_role: Mapped[ReviewerRole] = mapped_column(
        Enum(ReviewerRole, name="reviewer_role", create_type=False),
        nullable=False,
    )

    # Display
    display_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    scores: Mapped[list["ReviewDimensionScore"]] = relationship(
        "ReviewDimensionScore", back_populates="dimension"
    )

    def __repr__(self) -> str:
        return (
            f"<ReviewDimension(id={self.id}, slug={self.slug}, "
            f"weight={self.weight}, role={self.applicable_role})>"
        )


class ReviewDimensionScore(Base):
    """
    Individual dimension score for a review.
    No updated_at -- scores are set once at review time.
    """
    __tablename__ = "review_dimension_scores"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    review_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("reviews.id", ondelete="CASCADE"),
        nullable=False,
    )
    dimension_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("review_dimensions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    score: Mapped[Decimal] = mapped_column(Numeric(3, 2), nullable=False)

    # Immutable timestamp -- no updated_at
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    review: Mapped["Review"] = relationship(
        "Review", back_populates="dimension_scores"
    )
    dimension: Mapped["ReviewDimension"] = relationship(
        "ReviewDimension", back_populates="scores"
    )

    def __repr__(self) -> str:
        return (
            f"<ReviewDimensionScore(review={self.review_id}, "
            f"dimension={self.dimension_id}, score={self.score})>"
        )
