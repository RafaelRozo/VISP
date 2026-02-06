"""
SQLAlchemy models for provider_credentials, provider_insurance_policies, and legal_consents.
Corresponds to migration 004_create_verification.sql.
"""

import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import INET, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CredentialStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    VERIFIED = "verified"
    REJECTED = "rejected"
    EXPIRED = "expired"
    REVOKED = "revoked"


class CredentialType(str, enum.Enum):
    LICENSE = "license"
    CERTIFICATION = "certification"
    PERMIT = "permit"
    TRAINING = "training"
    BACKGROUND_CHECK = "background_check"
    PORTFOLIO = "portfolio"


class InsuranceStatus(str, enum.Enum):
    PENDING_REVIEW = "pending_review"
    VERIFIED = "verified"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    REJECTED = "rejected"


class ConsentType(str, enum.Enum):
    PLATFORM_TOS = "platform_tos"
    PROVIDER_IC_AGREEMENT = "provider_ic_agreement"
    LEVEL_1_TERMS = "level_1_terms"
    LEVEL_2_TERMS = "level_2_terms"
    LEVEL_3_TERMS = "level_3_terms"
    LEVEL_4_EMERGENCY_SLA = "level_4_emergency_sla"
    CUSTOMER_SERVICE_AGREEMENT = "customer_service_agreement"
    EMERGENCY_PRICING_CONSENT = "emergency_pricing_consent"


class ProviderCredential(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_credentials"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    credential_type: Mapped[CredentialType] = mapped_column(
        Enum(CredentialType, name="credential_type", create_type=False),
        nullable=False,
    )

    # Credential details
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    issuing_authority: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    credential_number: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)

    # Jurisdiction
    jurisdiction_country: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)
    jurisdiction_province_state: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )

    # Validity
    issued_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Verification
    status: Mapped[CredentialStatus] = mapped_column(
        Enum(CredentialStatus, name="credential_status", create_type=False),
        nullable=False,
        server_default="PENDING_REVIEW",
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verified_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Document storage
    document_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="credentials"
    )
    verifier: Mapped[Optional["User"]] = relationship("User", foreign_keys=[verified_by])

    def __repr__(self) -> str:
        return (
            f"<ProviderCredential(id={self.id}, provider={self.provider_id}, "
            f"type={self.credential_type}, status={self.status})>"
        )


class ProviderInsurancePolicy(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_insurance_policies"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Policy details
    policy_number: Mapped[str] = mapped_column(String(200), nullable=False)
    insurer_name: Mapped[str] = mapped_column(String(300), nullable=False)
    policy_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # Coverage (stored in cents)
    coverage_amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deductible_cents: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Validity
    effective_date: Mapped[date] = mapped_column(Date, nullable=False)
    expiry_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Verification
    status: Mapped[InsuranceStatus] = mapped_column(
        Enum(InsuranceStatus, name="insurance_status", create_type=False),
        nullable=False,
        server_default="PENDING_REVIEW",
    )
    verified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verified_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # Document
    document_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    document_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="insurance_policies"
    )
    verifier: Mapped[Optional["User"]] = relationship("User", foreign_keys=[verified_by])

    def __repr__(self) -> str:
        return (
            f"<ProviderInsurancePolicy(id={self.id}, provider={self.provider_id}, "
            f"policy={self.policy_number}, status={self.status})>"
        )


class LegalConsent(Base):
    """
    Immutable legal consent record.
    Every consent action is a new row -- never UPDATE or DELETE.
    No updated_at column by design.
    """
    __tablename__ = "legal_consents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )
    consent_type: Mapped[ConsentType] = mapped_column(
        Enum(ConsentType, name="consent_type", create_type=False),
        nullable=False,
    )

    # Consent version tracking
    consent_version: Mapped[str] = mapped_column(String(50), nullable=False)
    consent_text_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    consent_text: Mapped[str] = mapped_column(Text, nullable=False)

    # Consent action
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)

    # Audit fields
    ip_address: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    device_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Immutable timestamp -- no updated_at
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="legal_consents")

    def __repr__(self) -> str:
        return (
            f"<LegalConsent(id={self.id}, user={self.user_id}, "
            f"type={self.consent_type}, version={self.consent_version}, "
            f"granted={self.granted})>"
        )
