"""
SQLAlchemy models for VISP for Business (multi-tenant foundation, SP1).
Corresponds to migration 019_visp_for_business.sql.
"""

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from .user import User


class CompanyStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    VALIDATED = "validated"
    REJECTED = "rejected"


class CompanyMemberRole(str, enum.Enum):
    ADMIN = "admin"
    SUPERVISOR = "supervisor"
    COLLABORATOR = "collaborator"


class CompanyMemberStatus(str, enum.Enum):
    ACTIVE = "active"
    INVITED = "invited"
    DISABLED = "disabled"


class CompanyDocumentType(str, enum.Enum):
    LEGAL_INFO = "legal_info"
    BUSINESS_REGISTRATION = "business_registration"
    BUSINESS_NUMBER_TAX = "business_number_tax"
    OWNER_ID = "owner_id"
    AUTHORITY_PROOF = "authority_proof"
    ADDRESS_PROOF = "address_proof"
    BANKING = "banking"
    INSURANCE = "insurance"
    LICENSE_CERT = "license_cert"
    OPERATIONAL_PROFILE = "operational_profile"


class CompanyDocumentStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class CompanyInviteStatus(str, enum.Enum):
    PENDING = "pending"
    REDEEMED = "redeemed"
    EXPIRED = "expired"


class Company(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "companies"

    legal_name: Mapped[str] = mapped_column(String(300), nullable=False)
    trade_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    business_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[CompanyStatus] = mapped_column(
        Enum(CompanyStatus, name="company_status", create_type=False),
        nullable=False,
        server_default="DRAFT",
    )
    stripe_account_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    members: Mapped[list["CompanyMember"]] = relationship(
        "CompanyMember", back_populates="company", cascade="all, delete-orphan"
    )
    documents: Mapped[list["CompanyDocument"]] = relationship(
        "CompanyDocument", back_populates="company", cascade="all, delete-orphan"
    )
    services: Mapped[list["CompanyService"]] = relationship(
        "CompanyService", back_populates="company", cascade="all, delete-orphan"
    )


class CompanyMember(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_members"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_member"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[CompanyMemberRole] = mapped_column(
        Enum(CompanyMemberRole, name="company_member_role", create_type=False),
        nullable=False,
        server_default="COLLABORATOR",
    )
    status: Mapped[CompanyMemberStatus] = mapped_column(
        Enum(CompanyMemberStatus, name="company_member_status", create_type=False),
        nullable=False,
        server_default="ACTIVE",
    )

    company: Mapped["Company"] = relationship("Company", back_populates="members")
    # Read-only link to the underlying user for enriched serialization
    # (member names/emails on the company dashboard). Uses the existing
    # ``user_id`` FK; viewonly so it never participates in flush/cascade.
    user: Mapped["User"] = relationship("User", viewonly=True, lazy="select")


class CompanyDocument(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_documents"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    doc_type: Mapped[CompanyDocumentType] = mapped_column(
        Enum(CompanyDocumentType, name="company_document_type", create_type=False),
        nullable=False,
    )
    document_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[CompanyDocumentStatus] = mapped_column(
        Enum(CompanyDocumentStatus, name="company_document_status", create_type=False),
        nullable=False,
        server_default="PENDING",
    )
    verified_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("superusers.id"), nullable=True
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    company: Mapped["Company"] = relationship("Company", back_populates="documents")


class CompanyService(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_services"
    __table_args__ = (UniqueConstraint("company_id", "task_id", name="uq_company_service"),)

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("service_tasks.id", ondelete="CASCADE"), nullable=False
    )

    company: Mapped["Company"] = relationship("Company", back_populates="services")


class CompanyInvite(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_invites"

    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[CompanyMemberRole] = mapped_column(
        Enum(CompanyMemberRole, name="company_member_role", create_type=False),
        nullable=False,
        server_default="COLLABORATOR",
    )
    code: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)
    status: Mapped[CompanyInviteStatus] = mapped_column(
        Enum(CompanyInviteStatus, name="company_invite_status", create_type=False),
        nullable=False,
        server_default="PENDING",
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    redeemed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
