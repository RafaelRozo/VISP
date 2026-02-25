"""
VISP SQLAlchemy Models
=============================

Central import point for all ORM models. Import ``Base`` from here for
Alembic auto-generation and for the ``create_all`` convenience in tests.

Usage::

    from src.models import Base, User, Job, ProviderProfile
"""

# -- Base & Mixins --
from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin

# -- 001: Users --
from .user import AuthProvider, User, UserStatus

# -- 002: Providers --
from .provider import (
    BackgroundCheckStatus,
    ProviderAvailability,
    ProviderLevel,
    ProviderLevelRecord,
    ProviderProfile,
    ProviderProfileStatus,
)

# -- 003: Taxonomy --
from .taxonomy import ProviderTaskQualification, ServiceCategory, ServiceTask

# -- 004: Verification & Legal --
from .verification import (
    ConsentType,
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    LegalConsent,
    ProviderCredential,
    ProviderInsurancePolicy,
)

# -- 005: Jobs --
from .job import (
    AssignmentStatus,
    EscalationType,
    Job,
    JobAssignment,
    JobEscalation,
    JobPriority,
    JobStatus,
)

# -- 006: SLA --
from .sla import OnCallShift, OnCallStatus, SLAProfile, SLARegionType

# -- 007: Pricing --
from .pricing import (
    CommissionSchedule,
    PricingEvent,
    PricingEventType,
    PricingRule,
    PricingRuleType,
)

# -- 011: Price Proposals --
from .price_proposal import PriceProposal

# -- 011: Tips --
from .tip import Tip

# -- 008: Reviews --
from .review import (
    Review,
    ReviewDimension,
    ReviewDimensionScore,
    ReviewerRole,
    ReviewStatus,
)

# -- 009: Chat --
from .chat import ChatMessage, MessageType

# -- 010: Notifications --
from .notification import (
    DevicePlatform,
    DeviceToken,
    Notification,
    NotificationPreference,
    NotificationType,
)

__all__ = [
    # Base
    "Base",
    "TimestampMixin",
    "UUIDPrimaryKeyMixin",
    # Users
    "User",
    "UserStatus",
    "AuthProvider",
    # Providers
    "ProviderProfile",
    "ProviderProfileStatus",
    "ProviderLevel",
    "ProviderLevelRecord",
    "ProviderAvailability",
    "BackgroundCheckStatus",
    # Taxonomy
    "ServiceCategory",
    "ServiceTask",
    "ProviderTaskQualification",
    # Verification
    "ProviderCredential",
    "CredentialStatus",
    "CredentialType",
    "ProviderInsurancePolicy",
    "InsuranceStatus",
    "LegalConsent",
    "ConsentType",
    # Jobs
    "Job",
    "JobStatus",
    "JobPriority",
    "JobAssignment",
    "AssignmentStatus",
    "JobEscalation",
    "EscalationType",
    # SLA
    "SLAProfile",
    "SLARegionType",
    "OnCallShift",
    "OnCallStatus",
    # Pricing
    "PricingRule",
    "PricingRuleType",
    "PricingEvent",
    "PricingEventType",
    "CommissionSchedule",
    # Price Proposals
    "PriceProposal",
    # Tips
    "Tip",
    # Reviews
    "Review",
    "ReviewStatus",
    "ReviewerRole",
    "ReviewDimension",
    "ReviewDimensionScore",
    # Chat
    "ChatMessage",
    "MessageType",
    # Notifications
    "DeviceToken",
    "DevicePlatform",
    "Notification",
    "NotificationType",
    "NotificationPreference",
]
