"""
Admin API Routes -- Superuser dashboard backend.

All endpoints under /api/v1/admin/* are protected by ADMIN_JWT_SECRET
(via CurrentAdmin dependency), independent of the regular user JWT.

Routes:
  POST  /api/v1/admin/auth/login          -- Superuser login
  POST  /api/v1/admin/auth/refresh        -- Refresh admin tokens
  GET   /api/v1/admin/me                  -- Current superuser info
  GET   /api/v1/admin/dashboard/stats     -- KPI totals
  GET   /api/v1/admin/dashboard/charts    -- Time series for charts
  GET   /api/v1/admin/users               -- Paginated user list
  PATCH /api/v1/admin/users/{id}          -- Update user (role / status)
  GET   /api/v1/admin/credentials/pending -- Documents needing review
  POST  /api/v1/admin/credentials/{id}/approve
  POST  /api/v1/admin/credentials/{id}/reject
  GET   /api/v1/admin/promotions
  POST  /api/v1/admin/promotions
  PATCH /api/v1/admin/promotions/{id}
  DELETE /api/v1/admin/promotions/{id}
  GET   /api/v1/admin/taxonomy/full       -- Categories with nested tasks
  POST  /api/v1/admin/taxonomy/categories
  PATCH /api/v1/admin/taxonomy/categories/{id}
  DELETE /api/v1/admin/taxonomy/categories/{id}
  POST  /api/v1/admin/taxonomy/tasks
  PATCH /api/v1/admin/taxonomy/tasks/{id}
  DELETE /api/v1/admin/taxonomy/tasks/{id}
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status

logger = logging.getLogger(__name__)
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.api.deps import CurrentAdmin, DBSession
from src.api.schemas.company import RejectIn
from src.services import company_service
from src.models.job import Job, JobAssignment, JobStatus
from src.models.promotion import Promotion
from src.models.provider import ProviderLevel, ProviderProfile
from src.models.user import User
from src.models.taxonomy import (
    ServiceTaskQuestion,
    CredentialRequirement,
    ServiceCategory,
    ServiceCredentialRequirement,
    ServiceTask,
)
from src.models.verification import (
    CredentialStatus,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
)
from src.services import admin_service


router = APIRouter(prefix="/admin", tags=["Admin"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class _CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda s: ''.join(
            [s.split('_')[0]] + [w.capitalize() for w in s.split('_')[1:]]
        ),
        populate_by_name=True,
    )


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminTokenResponse(_CamelModel):
    access_token: str
    refresh_token: str
    expires_at: int


class AdminUserOut(_CamelModel):
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    last_login_at: Optional[datetime] = None


class AdminLoginResponse(_CamelModel):
    user: AdminUserOut
    tokens: AdminTokenResponse


class RefreshRequest(_CamelModel):
    refresh_token: str


class PromotionCreate(_CamelModel):
    code: str
    title: str
    description: Optional[str] = None
    discount_type: str = Field(pattern=r"^(percentage|fixed_amount)$")
    discount_value: Decimal
    starts_at: datetime
    ends_at: datetime
    max_redemptions: Optional[int] = None
    is_active: bool = True


class PromotionUpdate(_CamelModel):
    code: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    discount_type: Optional[str] = Field(default=None, pattern=r"^(percentage|fixed_amount)$")
    discount_value: Optional[Decimal] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    max_redemptions: Optional[int] = None
    is_active: Optional[bool] = None


class PromotionOut(_CamelModel):
    id: uuid.UUID
    code: str
    title: str
    description: Optional[str]
    discount_type: str
    discount_value: Decimal
    starts_at: datetime
    ends_at: datetime
    max_redemptions: Optional[int]
    redemptions_count: int
    is_active: bool
    created_at: datetime


class UserPatchRequest(_CamelModel):
    role: Optional[str] = Field(default=None, pattern=r"^(customer|provider|both)$")
    status: Optional[str] = Field(default=None, pattern=r"^(active|suspended|banned|deactivated)$")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _su_to_out(su) -> AdminUserOut:
    return AdminUserOut(
        id=su.id,
        email=su.email,
        first_name=su.first_name,
        last_name=su.last_name,
        role=su.role,
        is_active=su.is_active,
        last_login_at=su.last_login_at,
    )


def _user_to_dict(u: User) -> dict[str, Any]:
    if u.role_customer and u.role_provider:
        role = "both"
    elif u.role_provider:
        role = "provider"
    else:
        role = "customer"

    # Provider profile is eager-loaded for stripe + diagnostic info.
    profile = getattr(u, "provider_profile", None)
    provider_data: Optional[dict[str, Any]] = None
    if profile is not None:
        provider_data = {
            "providerId": str(profile.id),
            "providerStatus": (
                profile.status.value if hasattr(profile.status, "value") else str(profile.status)
            ),
            "providerLevel": (
                profile.current_level.value
                if hasattr(profile.current_level, "value")
                else str(profile.current_level)
            ),
            "stripeAccountId": profile.stripe_account_id,
            "stripeConnected": bool(profile.stripe_account_id),
            "backgroundCheckStatus": (
                profile.background_check_status.value
                if hasattr(profile.background_check_status, "value")
                else str(profile.background_check_status)
            ),
            "internalScore": float(profile.internal_score) if profile.internal_score is not None else None,
            "isOnline": bool(profile.is_online),
            "availableForEmergency": bool(profile.available_for_emergency),
            "activatedAt": profile.activated_at.isoformat() if profile.activated_at else None,
        }

    auth_provider = (
        u.auth_provider.value if hasattr(u.auth_provider, "value") else str(u.auth_provider)
    )

    return {
        "id": str(u.id),
        "email": u.email,
        "phone": u.phone,
        "firstName": u.first_name,
        "lastName": u.last_name,
        "displayName": u.display_name,
        "avatarUrl": u.avatar_url,
        "role": role,
        "status": u.status.value if hasattr(u.status, "value") else str(u.status),
        "emailVerified": bool(u.email_verified),
        "phoneVerified": bool(u.phone_verified),
        "authProvider": auth_provider,
        # Stripe diagnostic
        "stripeCustomerId": u.stripe_customer_id,
        "hasCard": bool(u.stripe_customer_id),
        # Address (helps diagnose location-based matching issues)
        "address": {
            "street": u.default_address_street,
            "city": u.default_address_city,
            "province": u.default_address_province,
            "postalCode": u.default_address_postal_code,
            "country": u.default_address_country,
        },
        # Preferences
        "timezone": u.timezone,
        "locale": u.locale,
        # Provider profile (None if not a provider)
        "provider": provider_data,
        # Top-level convenience (so frontend doesn't need to drill into provider)
        "stripeConnected": bool(provider_data and provider_data.get("stripeConnected")),
        # Timestamps
        "createdAt": u.created_at.isoformat() if u.created_at else None,
        "lastLoginAt": u.last_login_at.isoformat() if u.last_login_at else None,
        "deletedAt": u.deleted_at.isoformat() if u.deleted_at else None,
    }


def _require_super_admin(admin) -> None:
    """403 if the caller is not a super_admin. Used to gate user management."""
    if getattr(admin, "role", None) != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only super_admin can manage users.",
        )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@router.post("/auth/login", response_model=AdminLoginResponse)
async def admin_login(body: AdminLoginRequest, db: DBSession) -> AdminLoginResponse:
    try:
        user, tokens = await admin_service.login(db, body.email, body.password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        )
    return AdminLoginResponse(
        user=_su_to_out(user),
        tokens=AdminTokenResponse(
            access_token=tokens["accessToken"],
            refresh_token=tokens["refreshToken"],
            expires_at=tokens["expiresAt"],
        ),
    )


@router.post("/auth/refresh", response_model=AdminTokenResponse)
async def admin_refresh(body: RefreshRequest, db: DBSession) -> AdminTokenResponse:
    try:
        _, tokens = await admin_service.refresh_admin_tokens(db, body.refresh_token)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        )
    return AdminTokenResponse(
        access_token=tokens["accessToken"],
        refresh_token=tokens["refreshToken"],
        expires_at=tokens["expiresAt"],
    )


@router.get("/me", response_model=AdminUserOut)
async def admin_me(admin: CurrentAdmin) -> AdminUserOut:
    return _su_to_out(admin)


# ---------------------------------------------------------------------------
# Superuser management (super_admin only) + redeem endpoints (public)
# ---------------------------------------------------------------------------


class _InviteRequest(_CamelModel):
    email: EmailStr
    role: str = Field(default="admin", pattern=r"^(admin|super_admin)$")
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class _ResetCodeRequest(_CamelModel):
    superuser_id: uuid.UUID


class _RedeemInviteRequest(_CamelModel):
    email: EmailStr
    code: str = Field(min_length=8, max_length=20)
    password: str = Field(min_length=8, max_length=72)


class _RedeemResetRequest(_CamelModel):
    email: EmailStr
    code: str = Field(min_length=8, max_length=20)
    password: str = Field(min_length=8, max_length=72)


def _require_super_admin(admin) -> None:
    if admin.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super_admin can manage other admin accounts.",
        )


@router.get("/superusers")
async def list_superusers(db: DBSession, admin: CurrentAdmin) -> dict[str, Any]:
    _require_super_admin(admin)
    from src.models.superuser import SuperUser

    rows = (
        await db.execute(select(SuperUser).order_by(SuperUser.created_at.desc()))
    ).scalars().all()
    items = [
        {
            "id": str(su.id),
            "email": su.email,
            "firstName": su.first_name,
            "lastName": su.last_name,
            "role": su.role,
            "isActive": su.is_active,
            "lastLoginAt": su.last_login_at.isoformat() if su.last_login_at else None,
            "createdAt": su.created_at.isoformat() if su.created_at else None,
        }
        for su in rows
    ]
    return {"data": items}


@router.post("/superusers/invite", status_code=status.HTTP_201_CREATED)
async def invite_superuser(
    db: DBSession,
    admin: CurrentAdmin,
    body: _InviteRequest,
) -> dict[str, Any]:
    _require_super_admin(admin)
    try:
        plaintext, row = await admin_service.create_invite_code(
            db,
            inviter=admin,
            email=body.email,
            role=body.role,
            first_name=body.first_name,
            last_name=body.last_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {
        "data": {
            "id": str(row.id),
            "email": row.email,
            "role": row.invited_role,
            "code": plaintext,
            "expiresAt": row.expires_at.isoformat(),
        }
    }


@router.post("/superusers/{superuser_id}/reset-code", status_code=status.HTTP_201_CREATED)
async def admin_create_reset_code(
    db: DBSession,
    admin: CurrentAdmin,
    superuser_id: uuid.UUID,
) -> dict[str, Any]:
    _require_super_admin(admin)
    try:
        plaintext, row = await admin_service.create_reset_code(
            db, inviter=admin, superuser_id=superuser_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return {
        "data": {
            "id": str(row.id),
            "email": row.email,
            "code": plaintext,
            "expiresAt": row.expires_at.isoformat(),
        }
    }


@router.patch("/superusers/{superuser_id}/active")
async def admin_toggle_active(
    db: DBSession,
    admin: CurrentAdmin,
    superuser_id: uuid.UUID,
) -> dict[str, Any]:
    _require_super_admin(admin)
    from src.models.superuser import SuperUser

    if superuser_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )
    su = (await db.execute(select(SuperUser).where(SuperUser.id == superuser_id))).scalar_one_or_none()
    if su is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superuser not found.")
    su.is_active = not su.is_active
    await db.commit()
    await db.refresh(su)
    return {"data": {"id": str(su.id), "isActive": su.is_active}}


@router.delete("/superusers/{superuser_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_superuser(
    db: DBSession,
    admin: CurrentAdmin,
    superuser_id: uuid.UUID,
) -> None:
    _require_super_admin(admin)
    from src.models.superuser import SuperUser

    if superuser_id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own account.",
        )
    su = (await db.execute(select(SuperUser).where(SuperUser.id == superuser_id))).scalar_one_or_none()
    if su is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superuser not found.")
    await db.delete(su)
    await db.commit()


@router.get("/users/recovery-codes")
async def list_user_recovery_codes(db: DBSession, admin: CurrentAdmin) -> dict[str, Any]:
    """Dump every user's recovery code. Restricted to super_admin."""
    _require_super_admin(admin)
    stmt = select(User.email, User.first_name, User.last_name, User.recovery_code).order_by(User.created_at.asc())
    rows = (await db.execute(stmt)).all()
    return {
        "data": [
            {
                "email": email,
                "firstName": fn,
                "lastName": ln,
                "recoveryCode": rc,
            }
            for email, fn, ln, rc in rows
        ]
    }


@router.get("/users/{user_id}/recovery-code")
async def admin_get_user_recovery_code(
    db: DBSession,
    admin: CurrentAdmin,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Return the existing recovery code for a single user (super_admin only).

    Read-only: this endpoint NEVER generates a new code. If the user has not
    yet viewed/generated their own recovery code via the mobile app, this
    returns recoveryCode=None so the dashboard can show "Not generated yet"
    and the super_admin knows the user must open it themselves first.
    Generating it here would create a code the user doesn't know about, which
    would confuse them if they later try to use a different code.
    """
    _require_super_admin(admin)

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Audit trail: log who viewed what (until proper audit table exists).
    logger.info(
        "Super admin %s viewed recovery code for user %s (email=%s, present=%s)",
        admin.id,
        user.id,
        user.email,
        user.recovery_code is not None,
    )

    return {
        "data": {
            "userId": str(user.id),
            "recoveryCode": user.recovery_code,
        }
    }


@router.post("/auth/redeem-invite", response_model=AdminLoginResponse)
async def redeem_invite(body: _RedeemInviteRequest, db: DBSession) -> AdminLoginResponse:
    try:
        su = await admin_service.redeem_invite(
            db, email=body.email, code=body.code, password=body.password
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    tokens = admin_service.create_admin_tokens(su.id)
    return AdminLoginResponse(
        user=_su_to_out(su),
        tokens=AdminTokenResponse(
            access_token=tokens["accessToken"],
            refresh_token=tokens["refreshToken"],
            expires_at=tokens["expiresAt"],
        ),
    )


@router.post("/auth/redeem-reset", response_model=AdminLoginResponse)
async def redeem_reset(body: _RedeemResetRequest, db: DBSession) -> AdminLoginResponse:
    try:
        su = await admin_service.redeem_reset(
            db, email=body.email, code=body.code, password=body.password
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    tokens = admin_service.create_admin_tokens(su.id)
    return AdminLoginResponse(
        user=_su_to_out(su),
        tokens=AdminTokenResponse(
            access_token=tokens["accessToken"],
            refresh_token=tokens["refreshToken"],
            expires_at=tokens["expiresAt"],
        ),
    )


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------

@router.get("/dashboard/stats")
async def dashboard_stats(db: DBSession, _: CurrentAdmin) -> dict[str, Any]:
    """High-level KPIs for the dashboard."""
    # Users by role
    total_users = (await db.execute(select(func.count(User.id)))).scalar() or 0
    customers = (
        await db.execute(
            select(func.count(User.id)).where(
                User.role_customer == True, User.role_provider == False  # noqa: E712
            )
        )
    ).scalar() or 0
    providers = (
        await db.execute(
            select(func.count(User.id)).where(
                User.role_customer == False, User.role_provider == True  # noqa: E712
            )
        )
    ).scalar() or 0
    both = (
        await db.execute(
            select(func.count(User.id)).where(
                User.role_customer == True, User.role_provider == True  # noqa: E712
            )
        )
    ).scalar() or 0

    # Active in last 7 days = users with last_login_at within window
    seven_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_7d = (
        await db.execute(
            select(func.count(User.id)).where(User.last_login_at >= seven_ago)
        )
    ).scalar() or 0

    # Jobs
    jobs_total = (await db.execute(select(func.count(Job.id)))).scalar() or 0
    jobs_in_progress = (
        await db.execute(
            select(func.count(Job.id)).where(
                Job.status.in_([
                    JobStatus.PROVIDER_ACCEPTED,
                    JobStatus.PROVIDER_EN_ROUTE,
                    JobStatus.IN_PROGRESS,
                ])
            )
        )
    ).scalar() or 0
    jobs_completed = (
        await db.execute(
            select(func.count(Job.id)).where(Job.status == JobStatus.COMPLETED)
        )
    ).scalar() or 0
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    jobs_today = (
        await db.execute(
            select(func.count(Job.id)).where(Job.created_at >= today_start)
        )
    ).scalar() or 0

    # Revenue (sum of quoted_price_cents on completed jobs)
    revenue_cents = (
        await db.execute(
            select(func.coalesce(func.sum(Job.quoted_price_cents), 0)).where(
                Job.status == JobStatus.COMPLETED
            )
        )
    ).scalar() or 0
    thirty_ago = datetime.now(timezone.utc) - timedelta(days=30)
    revenue_30d_cents = (
        await db.execute(
            select(func.coalesce(func.sum(Job.quoted_price_cents), 0)).where(
                Job.status == JobStatus.COMPLETED,
                Job.completed_at >= thirty_ago,
            )
        )
    ).scalar() or 0

    # Pending credentials count
    pending_creds = (
        await db.execute(
            select(func.count(ProviderCredential.id)).where(
                ProviderCredential.status == CredentialStatus.PENDING_REVIEW
            )
        )
    ).scalar() or 0

    return {
        "data": {
            "users": {
                "total": int(total_users),
                "customers": int(customers),
                "providers": int(providers),
                "both": int(both),
                "active7d": int(active_7d),
            },
            "jobs": {
                "total": int(jobs_total),
                "today": int(jobs_today),
                "inProgress": int(jobs_in_progress),
                "completed": int(jobs_completed),
            },
            "revenue": {
                "totalCents": int(revenue_cents),
                "last30dCents": int(revenue_30d_cents),
            },
            "credentials": {
                "pendingReview": int(pending_creds),
            },
        }
    }


@router.get("/dashboard/charts")
async def dashboard_charts(
    db: DBSession,
    _: CurrentAdmin,
    period: str = Query("30d", pattern=r"^(7d|30d|90d)$"),
) -> dict[str, Any]:
    """Daily series for the charts."""
    days = {"7d": 7, "30d": 30, "90d": 90}[period]
    start = datetime.now(timezone.utc) - timedelta(days=days)

    # Daily new users
    user_daily = (
        await db.execute(
            select(
                func.date_trunc("day", User.created_at).label("d"),
                func.count(User.id),
            )
            .where(User.created_at >= start)
            .group_by("d")
            .order_by("d")
        )
    ).all()

    # Daily completed jobs + revenue
    job_daily = (
        await db.execute(
            select(
                func.date_trunc("day", Job.completed_at).label("d"),
                func.count(Job.id),
                func.coalesce(func.sum(Job.quoted_price_cents), 0),
            )
            .where(
                Job.status == JobStatus.COMPLETED,
                Job.completed_at >= start,
            )
            .group_by("d")
            .order_by("d")
        )
    ).all()

    return {
        "data": {
            "period": period,
            "newUsers": [
                {"date": row[0].date().isoformat(), "count": int(row[1])}
                for row in user_daily
            ],
            "completedJobs": [
                {
                    "date": row[0].date().isoformat(),
                    "count": int(row[1]),
                    "revenueCents": int(row[2]),
                }
                for row in job_daily
            ],
        }
    }


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(
    db: DBSession,
    admin: CurrentAdmin,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    search: Optional[str] = None,
    role: Optional[str] = Query(None, pattern=r"^(customer|provider|both)$"),
) -> dict[str, Any]:
    _require_super_admin(admin)
    stmt = select(User).options(selectinload(User.provider_profile))
    count_stmt = select(func.count(User.id))

    if search:
        like = f"%{search.lower()}%"
        stmt = stmt.where(
            (func.lower(User.email).like(like))
            | (func.lower(User.first_name).like(like))
            | (func.lower(User.last_name).like(like))
        )
        count_stmt = count_stmt.where(
            (func.lower(User.email).like(like))
            | (func.lower(User.first_name).like(like))
            | (func.lower(User.last_name).like(like))
        )

    if role == "customer":
        stmt = stmt.where(User.role_customer == True, User.role_provider == False)  # noqa: E712
        count_stmt = count_stmt.where(
            User.role_customer == True, User.role_provider == False  # noqa: E712
        )
    elif role == "provider":
        stmt = stmt.where(User.role_customer == False, User.role_provider == True)  # noqa: E712
        count_stmt = count_stmt.where(
            User.role_customer == False, User.role_provider == True  # noqa: E712
        )
    elif role == "both":
        stmt = stmt.where(User.role_customer == True, User.role_provider == True)  # noqa: E712
        count_stmt = count_stmt.where(
            User.role_customer == True, User.role_provider == True  # noqa: E712
        )

    total = (await db.execute(count_stmt)).scalar() or 0

    stmt = stmt.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()

    return {
        "data": {
            "items": [_user_to_dict(u) for u in rows],
            "meta": {
                "page": page,
                "pageSize": page_size,
                "total": int(total),
                "totalPages": (int(total) + page_size - 1) // page_size,
            },
        }
    }


@router.patch("/users/{user_id}")
async def patch_user(
    db: DBSession,
    admin: CurrentAdmin,
    user_id: uuid.UUID,
    body: UserPatchRequest,
) -> dict[str, Any]:
    _require_super_admin(admin)
    from src.models.user import UserStatus

    user = (
        await db.execute(
            select(User)
            .options(selectinload(User.provider_profile))
            .where(User.id == user_id)
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if body.role is not None:
        if body.role == "customer":
            user.role_customer, user.role_provider = True, False
        elif body.role == "provider":
            user.role_customer, user.role_provider = False, True
        else:  # both
            user.role_customer, user.role_provider = True, True
            # Ensure they have a provider profile if newly granted that role
            existing = (
                await db.execute(
                    select(ProviderProfile).where(ProviderProfile.user_id == user.id)
                )
            ).scalar_one_or_none()
            if existing is None:
                from src.models.provider import ProviderLevel, ProviderProfileStatus
                profile = ProviderProfile(
                    user_id=user.id,
                    current_level=ProviderLevel.LEVEL_1,
                    status=ProviderProfileStatus.ONBOARDING,
                )
                db.add(profile)

    if body.status is not None:
        user.status = UserStatus(body.status)

    await db.commit()
    await db.refresh(user)
    return {"data": _user_to_dict(user)}


# ---------------------------------------------------------------------------
# Credentials review
# ---------------------------------------------------------------------------

@router.get("/credentials/pending")
async def list_pending_credentials(
    db: DBSession,
    _: CurrentAdmin,
) -> dict[str, Any]:
    from sqlalchemy.orm import aliased

    SectionCat = aliased(ServiceCategory)
    stmt = (
        select(ProviderCredential, ProviderProfile, User, ServiceTask, ServiceCategory, SectionCat)
        .join(ProviderProfile, ProviderProfile.id == ProviderCredential.provider_id)
        .join(User, User.id == ProviderProfile.user_id)
        .outerjoin(ServiceTask, ServiceTask.id == ProviderCredential.task_id)
        .outerjoin(ServiceCategory, ServiceCategory.id == ServiceTask.category_id)
        # Section-based model (029): a credential now belongs directly to a SECTION.
        .outerjoin(SectionCat, SectionCat.id == ProviderCredential.category_id)
        .where(ProviderCredential.status == CredentialStatus.PENDING_REVIEW)
        .order_by(ProviderCredential.created_at.asc())
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for cred, profile, user, task, category, section in rows:
        items.append({
            "id": str(cred.id),
            "credentialType": cred.credential_type.value,
            "name": cred.name,
            "documentUrl": cred.document_url,
            "uploadedAt": cred.created_at.isoformat() if cred.created_at else None,
            # The SECTION this document is for (drives the L1->L2 flip on approval).
            "section": (
                {"id": str(section.id), "name": section.name}
                if section is not None
                else None
            ),
            "licenseClass": cred.license_class.value if cred.license_class else None,
            "task": (
                {
                    "id": str(task.id),
                    "name": task.name,
                    "level": int(task.level.value) if task.level else None,
                    "category": category.name if category else None,
                }
                if task is not None
                else None
            ),
            "provider": {
                "id": str(profile.id),
                "userId": str(user.id),
                "firstName": user.first_name,
                "lastName": user.last_name,
                "email": user.email,
                "level": int(profile.current_level.value) if profile.current_level else 1,
            },
        })
    return {"data": items}


class CredentialDecisionRequest(_CamelModel):
    note: Optional[str] = None
    # Ontario licence class (only for LICENSE credentials) — set at validation time.
    license_class: Optional[str] = None


@router.post("/credentials/{credential_id}/approve")
async def approve_credential(
    db: DBSession,
    admin: CurrentAdmin,
    credential_id: uuid.UUID,
    body: Optional[CredentialDecisionRequest] = None,
) -> dict[str, Any]:
    cred = (
        await db.execute(
            select(ProviderCredential).where(ProviderCredential.id == credential_id)
        )
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found.")

    # For a trade licence the admin records the Ontario licence class (G2/G in
    # practice). Validate against the enum so bad input is a clean 400.
    if body is not None and body.license_class:
        from src.models.verification import LicenseClass

        try:
            cred.license_class = LicenseClass(body.license_class)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid licence class '{body.license_class}'.",
            )

    cred.status = CredentialStatus.VERIFIED
    cred.verified_at = datetime.now(timezone.utc)
    # NOTE: `verified_by` is FK to users.id and superusers live in a separate
    # table. Audit which admin acted on the credential will live in a future
    # dedicated audit_log table.

    # Section-based model (migration 029): a newly VERIFIED section document may
    # flip the provider L1 -> L2 (or up to L3) and unlock gated tasks.
    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, cred.provider_id)

    await db.commit()
    return {"data": {"id": str(cred.id), "status": cred.status.value}}


@router.post("/credentials/{credential_id}/reject")
async def reject_credential(
    db: DBSession,
    admin: CurrentAdmin,
    credential_id: uuid.UUID,
    body: CredentialDecisionRequest,
) -> dict[str, Any]:
    cred = (
        await db.execute(
            select(ProviderCredential).where(ProviderCredential.id == credential_id)
        )
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Credential not found.")
    cred.status = CredentialStatus.REJECTED
    cred.rejection_reason = body.note or "Rejected by admin"
    cred.verified_at = datetime.now(timezone.utc)
    # NOTE: `verified_by` is FK to users.id and superusers live in a separate
    # table. Audit which admin acted on the credential will live in a future
    # dedicated audit_log table.

    # Losing a VERIFIED section document may demote the provider + revoke tasks.
    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, cred.provider_id)

    await db.commit()
    return {"data": {"id": str(cred.id), "status": cred.status.value}}


# ---------------------------------------------------------------------------
# Pólizas de seguro — cola de validación (WP1b)
# ---------------------------------------------------------------------------
#
# Estas rutas NO existían. `verificationService.approve_insurance` /
# `reject_insurance` estaban escritas pero ninguna ruta las llamaba: código
# muerto. Es decir, un proveedor podía subir su póliza y se quedaba en
# PENDING_REVIEW para siempre, así que el requisito CGL por servicio nunca podía
# abrirse. Sin esto, WP1b no sirve de nada.
#
# NO se reusan esas funciones a propósito: setean `policy.verified_by =
# admin_user_id`, y `verified_by` es FK a `users.id` mientras los admins viven en
# la tabla `superusers` — pasarles un id de superuser reventaría con violación de
# FK en tiempo de ejecución. Se sigue el mismo patrón que las credenciales, que
# ya omite esa columna por la misma razón.


@router.get("/insurance-policies", summary="Insurance policies pending review")
async def list_insurance_policies(
    db: DBSession,
    admin: CurrentAdmin,
    status_filter: Optional[str] = None,
) -> dict[str, Any]:
    stmt = (
        select(ProviderInsurancePolicy, ProviderProfile, User)
        .join(ProviderProfile, ProviderInsurancePolicy.provider_id == ProviderProfile.id)
        .join(User, ProviderProfile.user_id == User.id)
        .order_by(ProviderInsurancePolicy.created_at.desc())
    )
    if status_filter:
        # Los VALORES del enum de Python son minúsculas ('pending_review') pero
        # las etiquetas del enum de Postgres son mayúsculas ('PENDING_REVIEW'),
        # así que el admin puede mandar cualquiera de las dos formas. Se acepta
        # por valor y por nombre en vez de asumir una.
        raw = status_filter.strip()
        parsed: Optional[InsuranceStatus] = None
        for candidate in (raw, raw.lower(), raw.upper()):
            try:
                parsed = InsuranceStatus(candidate)
                break
            except ValueError:
                parsed = getattr(InsuranceStatus, candidate.upper(), None)
                if isinstance(parsed, InsuranceStatus):
                    break
                parsed = None
        if parsed is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid status '{status_filter}'. Valid: "
                    + ", ".join(s.value for s in InsuranceStatus)
                ),
            )
        stmt = stmt.where(ProviderInsurancePolicy.status == parsed)

    today = date.today()
    rows = (await db.execute(stmt)).all()
    return {
        "data": [
            {
                "id": str(p.id),
                "providerId": str(p.provider_id),
                "providerName": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email,
                "policyNumber": p.policy_number,
                "insurerName": p.insurer_name,
                "policyType": p.policy_type,
                "coverageAmountCents": p.coverage_amount_cents,
                "effectiveDate": p.effective_date.isoformat(),
                "expiryDate": p.expiry_date.isoformat(),
                # Se marca lo ya vencido: una póliza VERIFIED que caducó no debe
                # leerse como vigente en la pantalla del admin.
                "isExpired": p.expiry_date < today,
                "status": p.status.value,
                "documentUrl": p.document_url,
                "createdAt": p.created_at.isoformat() if p.created_at else None,
            }
            for p, _prof, u in rows
        ]
    }


@router.post("/insurance-policies/{policy_id}/approve")
async def approve_insurance_policy(
    db: DBSession,
    admin: CurrentAdmin,
    policy_id: uuid.UUID,
) -> dict[str, Any]:
    policy = (
        await db.execute(
            select(ProviderInsurancePolicy).where(ProviderInsurancePolicy.id == policy_id)
        )
    ).scalar_one_or_none()
    if policy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Insurance policy not found."
        )
    if policy.expiry_date < date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"This policy expired on {policy.expiry_date.isoformat()}. "
                f"Ask the provider to upload a current one instead of approving it."
            ),
        )

    policy.status = InsuranceStatus.VERIFIED
    policy.verified_at = datetime.now(timezone.utc)
    # `verified_by` se omite: FK a users.id y los admins son superusers. Igual que
    # en las credenciales, la auditoría de quién actuó irá en audit_log.

    # Una póliza recién verificada puede abrirle servicios que exigen CGL.
    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, policy.provider_id)

    await db.commit()
    return {"data": {"id": str(policy.id), "status": policy.status.value}}


@router.post("/insurance-policies/{policy_id}/reject")
async def reject_insurance_policy(
    db: DBSession,
    admin: CurrentAdmin,
    policy_id: uuid.UUID,
    body: CredentialDecisionRequest,
) -> dict[str, Any]:
    policy = (
        await db.execute(
            select(ProviderInsurancePolicy).where(ProviderInsurancePolicy.id == policy_id)
        )
    ).scalar_one_or_none()
    if policy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Insurance policy not found."
        )

    policy.status = InsuranceStatus.REJECTED
    policy.rejection_reason = body.note or "Rejected by admin"
    policy.verified_at = datetime.now(timezone.utc)

    # Perder la póliza puede cerrarle servicios que exigían CGL.
    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, policy.provider_id)

    await db.commit()
    return {"data": {"id": str(policy.id), "status": policy.status.value}}


# ---------------------------------------------------------------------------
# Expediente de experiencia (L1) — cola de validación, WP1c
# ---------------------------------------------------------------------------
#
# La validación es DOCUMENTAL, no de competencia: se confirma que la evidencia
# existe y está legible. Rechazar significa "documentación incompleta o
# ilegible", nunca "no eres competente" — el copy que ve el proveedor tiene que
# decir eso, porque es la diferencia entre un trámite y un juicio profesional.


@router.get("/experience-records", summary="Experience records pending validation")
async def list_experience_records(
    db: DBSession,
    admin: CurrentAdmin,
    status_filter: Optional[str] = None,
) -> dict[str, Any]:
    from src.models.verification import ExperienceRecordStatus, ProviderExperienceRecord

    stmt = (
        select(ProviderExperienceRecord, User)
        .join(ProviderProfile, ProviderExperienceRecord.provider_id == ProviderProfile.id)
        .join(User, ProviderProfile.user_id == User.id)
        .order_by(ProviderExperienceRecord.submitted_at.desc())
    )
    if status_filter:
        raw = status_filter.strip()
        parsed = None
        for candidate in (raw.lower(), raw.upper()):
            try:
                parsed = ExperienceRecordStatus(candidate)
                break
            except ValueError:
                attr = getattr(ExperienceRecordStatus, candidate.upper(), None)
                if isinstance(attr, ExperienceRecordStatus):
                    parsed = attr
                    break
        if parsed is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Invalid status '{status_filter}'. Valid: "
                    + ", ".join(s.value for s in ExperienceRecordStatus)
                ),
            )
        stmt = stmt.where(ProviderExperienceRecord.status == parsed)

    rows = (await db.execute(stmt)).all()
    return {
        "data": [
            {
                "id": str(r.id),
                "providerId": str(r.provider_id),
                "providerName": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email,
                "kind": r.kind.value,
                "title": r.title,
                "description": r.description,
                "documentUrl": r.document_url,
                "status": r.status.value,
                "rejectionReason": r.rejection_reason,
                # NULL = expediente global (modelo v1). Con valor = por clasificación.
                "categoryId": str(r.category_id) if r.category_id else None,
                "submittedAt": r.submitted_at.isoformat() if r.submitted_at else None,
            }
            for r, u in rows
        ]
    }


@router.post("/experience-records/{record_id}/validate")
async def validate_experience_record(
    db: DBSession,
    admin: CurrentAdmin,
    record_id: uuid.UUID,
) -> dict[str, Any]:
    from src.models.verification import ExperienceRecordStatus, ProviderExperienceRecord

    record = (
        await db.execute(
            select(ProviderExperienceRecord).where(ProviderExperienceRecord.id == record_id)
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Experience record not found."
        )

    record.status = ExperienceRecordStatus.VALIDATED
    record.validated_at = datetime.now(timezone.utc)
    record.rejection_reason = None
    # `validated_by` se omite: FK a users.id y los admins viven en `superusers`.
    # Igual que en credenciales y pólizas; la auditoría irá en audit_log.

    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, record.provider_id)

    await db.commit()
    return {"data": {"id": str(record.id), "status": record.status.value}}


@router.post("/experience-records/{record_id}/reject")
async def reject_experience_record(
    db: DBSession,
    admin: CurrentAdmin,
    record_id: uuid.UUID,
    body: CredentialDecisionRequest,
) -> dict[str, Any]:
    from src.models.verification import ExperienceRecordStatus, ProviderExperienceRecord

    record = (
        await db.execute(
            select(ProviderExperienceRecord).where(ProviderExperienceRecord.id == record_id)
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Experience record not found."
        )

    record.status = ExperienceRecordStatus.REJECTED
    record.validated_at = datetime.now(timezone.utc)
    # Sin motivo, el proveedor vuelve a subir lo mismo y la cola se llena de
    # reintentos idénticos. De ahí que se guarde siempre algo.
    record.rejection_reason = body.note or "Documentation incomplete or unreadable"

    from src.services import provider_level_service

    await provider_level_service.recompute_level_and_qualifications(db, record.provider_id)

    await db.commit()
    return {
        "data": {
            "id": str(record.id),
            "status": record.status.value,
            "rejectionReason": record.rejection_reason,
        }
    }


# ---------------------------------------------------------------------------
# Cancelaciones con motivo — cola de revisión (migración 041)
# ---------------------------------------------------------------------------
#
# La cancelación ya ocurrió y fue GRATIS. Lo que se decide aquí es si el reporte
# debe afectar la calificación del reportado.
#
# Por qué pasa por un humano: cancelación gratis + daño automático a la
# calificación, a partir de un texto que nadie verifica, es un arma. Quien se
# arrepiente escribe "llegó borracho", cancela sin coste y hunde a un proveedor
# honesto que no puede defenderse. Con L0/L1 y pocos trabajos, un golpe así pesa
# muchísimo.


class CancellationReviewRequest(_CamelModel):
    """UPHELD = se le da la razón a quien reporta. DISMISSED = sin fundamento."""

    status: str = Field(pattern=r"^(UPHELD|DISMISSED)$")
    rating_impact: bool = False
    admin_note: Optional[str] = None


@router.get("/cancellation-reports", summary="Cancellations pending review")
async def list_cancellation_reports(
    db: DBSession,
    admin: CurrentAdmin,
    status_filter: Optional[str] = None,
) -> dict[str, Any]:
    from src.models.job import Job, JobCancellationReport
    from src.models.taxonomy import ServiceTask

    stmt = (
        select(JobCancellationReport, Job, ServiceTask, User)
        .join(Job, Job.id == JobCancellationReport.job_id)
        .join(ServiceTask, ServiceTask.id == Job.task_id)
        .join(User, User.id == JobCancellationReport.reported_by)
        .order_by(JobCancellationReport.created_at.desc())
    )
    if status_filter:
        stmt = stmt.where(JobCancellationReport.status == status_filter.upper())

    rows = (await db.execute(stmt)).all()
    return {
        "data": [
            {
                "id": str(r.id),
                "jobId": str(r.job_id),
                "referenceNumber": j.reference_number,
                "taskName": t.name,
                "reporterRole": r.reporter_role,
                "reporterName": f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email,
                "reasonCode": r.reason_code,
                "note": r.note,
                "status": r.status,
                "ratingImpact": r.rating_impact,
                "adminNote": r.admin_note,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
            }
            for r, j, t, u in rows
        ]
    }


@router.post("/cancellation-reports/{report_id}/review")
async def review_cancellation_report(
    db: DBSession,
    admin: CurrentAdmin,
    report_id: uuid.UUID,
    body: CancellationReviewRequest,
) -> dict[str, Any]:
    from src.models.job import JobCancellationReport

    report = (
        await db.execute(
            select(JobCancellationReport).where(JobCancellationReport.id == report_id)
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Report not found."
        )

    report.status = body.status
    # Un reporte DESESTIMADO no puede afectar a nadie, diga lo que diga el resto
    # del formulario. Se fuerza aquí para que un descuido de la UI no penalice a
    # quien acaba de ser exonerado.
    report.rating_impact = body.rating_impact if body.status == "UPHELD" else False
    report.admin_note = (body.admin_note or "").strip() or None
    report.reviewed_at = datetime.now(timezone.utc)

    await db.commit()
    return {
        "data": {
            "id": str(report.id),
            "status": report.status,
            "ratingImpact": report.rating_impact,
        }
    }


# ---------------------------------------------------------------------------
# Promotions
# ---------------------------------------------------------------------------

def _promo_to_out(p: Promotion) -> dict[str, Any]:
    return {
        "id": str(p.id),
        "code": p.code,
        "title": p.title,
        "description": p.description,
        "discountType": p.discount_type,
        "discountValue": float(p.discount_value),
        "startsAt": p.starts_at.isoformat() if p.starts_at else None,
        "endsAt": p.ends_at.isoformat() if p.ends_at else None,
        "maxRedemptions": p.max_redemptions,
        "redemptionsCount": p.redemptions_count,
        "isActive": p.is_active,
        "createdAt": p.created_at.isoformat() if p.created_at else None,
    }


@router.get("/promotions")
async def list_promotions(db: DBSession, _: CurrentAdmin) -> dict[str, Any]:
    rows = (await db.execute(select(Promotion).order_by(Promotion.created_at.desc()))).scalars().all()
    return {"data": [_promo_to_out(p) for p in rows]}


@router.post("/promotions", status_code=status.HTTP_201_CREATED)
async def create_promotion(
    db: DBSession,
    _: CurrentAdmin,
    body: PromotionCreate,
) -> dict[str, Any]:
    p = Promotion(
        code=body.code,
        title=body.title,
        description=body.description,
        discount_type=body.discount_type,
        discount_value=body.discount_value,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        max_redemptions=body.max_redemptions,
        is_active=body.is_active,
    )
    db.add(p)
    try:
        await db.commit()
        await db.refresh(p)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not create promotion: {exc}",
        )
    return {"data": _promo_to_out(p)}


@router.patch("/promotions/{promotion_id}")
async def update_promotion(
    db: DBSession,
    _: CurrentAdmin,
    promotion_id: uuid.UUID,
    body: PromotionUpdate,
) -> dict[str, Any]:
    p = (
        await db.execute(select(Promotion).where(Promotion.id == promotion_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found.")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(p, field, value)

    await db.commit()
    await db.refresh(p)
    return {"data": _promo_to_out(p)}


@router.delete("/promotions/{promotion_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_promotion(
    db: DBSession,
    _: CurrentAdmin,
    promotion_id: uuid.UUID,
) -> None:
    p = (
        await db.execute(select(Promotion).where(Promotion.id == promotion_id))
    ).scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Promotion not found.")
    await db.delete(p)
    await db.commit()


# ---------------------------------------------------------------------------
# Taxonomy admin (Service categories + Service tasks)
# ---------------------------------------------------------------------------

class CategoryAdminCreate(_CamelModel):
    slug: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    icon_url: Optional[str] = None
    display_order: int = 0
    is_active: bool = True
    parent_id: Optional[uuid.UUID] = None
    # Section-based gating (migration 029): whole section locked to L2+ providers.
    requires_credential: bool = False
    # Bilingual (EN/FR) help pop-up shown before uploading this section's document.
    help_message_en: Optional[str] = None
    help_message_fr: Optional[str] = None


class CategoryAdminUpdate(_CamelModel):
    slug: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    icon_url: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None
    parent_id: Optional[uuid.UUID] = None
    requires_credential: Optional[bool] = None
    help_message_en: Optional[str] = None
    help_message_fr: Optional[str] = None


class TaskQuestionIn(_CamelModel):
    """Pregunta del servicio. `id` vacío = alta; con valor = actualización."""

    id: Optional[uuid.UUID] = None
    question_en: str = Field(min_length=1, max_length=2000)
    question_fr: Optional[str] = None
    answer_type: str = Field(default="TEXT", pattern=r"^(TEXT|SINGLE_CHOICE)$")
    # [{"en": "Light", "fr": "Léger"}, ...]. Solo para SINGLE_CHOICE.
    options: list[dict[str, Any]] = Field(default_factory=list)
    is_required: bool = True
    display_order: int = 0


class TaskCredentialRequirementIn(_CamelModel):
    """Un código de credencial exigido por un servicio.

    ``mandatory=False`` = condicional/alternativo (los casos "306A y/o 309A"
    del PDF de estructuración).
    """

    code: str = Field(min_length=1, max_length=40)
    mandatory: bool = True
    notes: Optional[str] = None


class TaskAdminCreate(_CamelModel):
    category_id: uuid.UUID
    slug: str = Field(min_length=1, max_length=150)
    name: str = Field(min_length=1, max_length=300)
    description: Optional[str] = None
    level: str = Field(pattern=r"^[0-3]$")
    regulated: bool = False
    license_required: bool = False
    certification_required: bool = False
    hazardous: bool = False
    structural: bool = False
    emergency_eligible: bool = False
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None
    # Charge unit + quantity (provider-set pricing). pricing_unit defaults to
    # HOURLY when omitted.
    pricing_unit: Optional[str] = None
    allows_quantity: bool = True
    min_quantity: Optional[float] = None
    escalation_keywords: list[str] = Field(default_factory=list)
    icon_url: Optional[str] = None
    display_order: int = 0
    is_active: bool = True
    # Requisitos de ENTRADA DE LA RESERVA (migración 038). Distintos de
    # credential_requirements: eso es lo que debe tener el PROVEEDOR, esto es lo
    # que debe aportar el CLIENTE al reservar para que el proveedor pueda decidir.
    requires_details: bool = False
    requires_evidence: bool = False
    details_prompt_en: Optional[str] = None
    details_prompt_fr: Optional[str] = None
    # Preguntas del servicio (migración 039). Reemplazan el conjunto completo.
    questions: list[TaskQuestionIn] = Field(default_factory=list)
    # Si TRUE, el servicio exige seguro CGL. Se traduce a una fila de
    # `service_credential_requirements` con el código CGL: NO es una columna
    # aparte, para que el motor tenga UNA sola fuente de requisitos.
    requires_insurance: bool = False
    # Requisitos de credencial por servicio (gate de L2/L3).
    credential_requirements: list[TaskCredentialRequirementIn] = Field(default_factory=list)


class TaskAdminUpdate(_CamelModel):
    category_id: Optional[uuid.UUID] = None
    slug: Optional[str] = Field(default=None, min_length=1, max_length=150)
    name: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = None
    level: Optional[str] = Field(default=None, pattern=r"^[0-3]$")
    regulated: Optional[bool] = None
    license_required: Optional[bool] = None
    certification_required: Optional[bool] = None
    hazardous: Optional[bool] = None
    structural: Optional[bool] = None
    emergency_eligible: Optional[bool] = None
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None
    pricing_unit: Optional[str] = None
    allows_quantity: Optional[bool] = None
    min_quantity: Optional[float] = None
    escalation_keywords: Optional[list[str]] = None
    icon_url: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None
    requires_details: Optional[bool] = None
    requires_evidence: Optional[bool] = None
    details_prompt_en: Optional[str] = None
    details_prompt_fr: Optional[str] = None
    questions: Optional[list[TaskQuestionIn]] = None
    requires_insurance: Optional[bool] = None
    # Cuando viene, REEMPLAZA el conjunto completo de requisitos del servicio.
    credential_requirements: Optional[list[TaskCredentialRequirementIn]] = None


def _level_value(level: Any) -> str:
    """Return the numeric string ('1'..'4') from a ProviderLevel enum or raw value."""
    if hasattr(level, "value"):
        return str(level.value)
    return str(level)


def _parse_pricing_unit(value: Any) -> "PricingUnit":
    """Accept a member name ('PER_AREA') or value ('per_area')."""
    from src.models.taxonomy import PricingUnit

    v = str(value or "").strip()
    try:
        return PricingUnit[v.upper()]
    except KeyError:
        return PricingUnit(v.lower())


def _task_to_out(
    t: ServiceTask,
    requirements: Optional[list[dict[str, Any]]] = None,
    questions: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    return {
        "credentialRequirements": requirements or [],
        "id": str(t.id),
        "categoryId": str(t.category_id),
        "slug": t.slug,
        "name": t.name,
        "description": t.description,
        "level": _level_value(t.level),
        "pricingUnit": t.pricing_unit.value if t.pricing_unit else None,
        "allowsQuantity": t.allows_quantity,
        "minQuantity": float(t.min_quantity) if t.min_quantity is not None else None,
        "regulated": t.regulated,
        "licenseRequired": t.license_required,
        "certificationRequired": t.certification_required,
        "hazardous": t.hazardous,
        "structural": t.structural,
        "emergencyEligible": t.emergency_eligible,
        "basePriceMinCents": t.base_price_min_cents,
        "basePriceMaxCents": t.base_price_max_cents,
        "estimatedDurationMin": t.estimated_duration_min,
        "escalationKeywords": t.escalation_keywords or [],
        "requiresInsurance": any(
            (r or {}).get("code") == _INSURANCE_CODE for r in (requirements or [])
        ),
        "questions": questions or [],
        "requiresDetails": t.requires_details,
        "requiresEvidence": t.requires_evidence,
        "detailsPromptEn": t.details_prompt_en,
        "detailsPromptFr": t.details_prompt_fr,
        "iconUrl": t.icon_url,
        "displayOrder": t.display_order,
        "isActive": t.is_active,
        "createdAt": t.created_at.isoformat() if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() if t.updated_at else None,
    }


def _category_to_out(
    c: ServiceCategory,
    tasks: Optional[list[ServiceTask]] = None,
    requirements: Optional[dict[uuid.UUID, list[dict[str, Any]]]] = None,
    questions: Optional[dict[uuid.UUID, list[dict[str, Any]]]] = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(c.id),
        "slug": c.slug,
        "name": c.name,
        "description": c.description,
        "iconUrl": c.icon_url,
        "displayOrder": c.display_order,
        "isActive": c.is_active,
        "parentId": str(c.parent_id) if c.parent_id else None,
        "requiresCredential": c.requires_credential,
        "helpMessageEn": c.help_message_en,
        "helpMessageFr": c.help_message_fr,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
    }
    if tasks is not None:
        reqs = requirements or {}
        qs = questions or {}
        out["tasks"] = [_task_to_out(t, reqs.get(t.id), qs.get(t.id)) for t in tasks]
        out["taskCount"] = len(tasks)
    return out


@router.get("/taxonomy/full")
async def taxonomy_full(db: DBSession, _: CurrentAdmin) -> dict[str, Any]:
    """Return all categories with their tasks nested in one payload."""
    cats = (
        await db.execute(
            select(ServiceCategory)
            .options(selectinload(ServiceCategory.tasks))
            .order_by(ServiceCategory.display_order, ServiceCategory.name)
        )
    ).scalars().all()

    all_task_ids = [t.id for c in cats for t in c.tasks]
    requirements = await _load_task_requirements(db, all_task_ids)
    questions = await _load_task_questions(db, all_task_ids)

    data: list[dict[str, Any]] = []
    for c in cats:
        # Ordenado por NIVEL (L0 -> L3) y luego por nombre: es el orden en que
        # el cliente revisa el catálogo tras la reestructuración de niveles.
        tasks_sorted = sorted(
            c.tasks,
            key=lambda t: (_level_value(t.level), t.name),
        )
        data.append(_category_to_out(c, tasks_sorted, requirements, questions))
    return {"data": data}


@router.post("/taxonomy/categories", status_code=status.HTTP_201_CREATED)
async def admin_create_category(
    db: DBSession,
    _: CurrentAdmin,
    body: CategoryAdminCreate,
) -> dict[str, Any]:
    cat = ServiceCategory(
        slug=body.slug,
        name=body.name,
        description=body.description,
        icon_url=body.icon_url,
        display_order=body.display_order,
        is_active=body.is_active,
        parent_id=body.parent_id,
        requires_credential=body.requires_credential,
        help_message_en=body.help_message_en,
        help_message_fr=body.help_message_fr,
    )
    db.add(cat)
    try:
        await db.commit()
        await db.refresh(cat)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not create category: {exc}",
        )
    return {"data": _category_to_out(cat, tasks=[])}


@router.patch("/taxonomy/categories/{category_id}")
async def admin_update_category(
    db: DBSession,
    _: CurrentAdmin,
    category_id: uuid.UUID,
    body: CategoryAdminUpdate,
) -> dict[str, Any]:
    cat = (
        await db.execute(select(ServiceCategory).where(ServiceCategory.id == category_id))
    ).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(cat, field, value)

    try:
        await db.commit()
        await db.refresh(cat)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Could not update category: {exc}")
    return {"data": _category_to_out(cat)}


@router.delete("/taxonomy/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_category(
    db: DBSession,
    _: CurrentAdmin,
    category_id: uuid.UUID,
) -> None:
    cat = (
        await db.execute(select(ServiceCategory).where(ServiceCategory.id == category_id))
    ).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    await db.delete(cat)
    await db.commit()


def _parse_level(level: str) -> ProviderLevel:
    """Escala L0..L3. LEVEL_4 quedó muerto (Emergency salió del producto)."""
    mapping = {
        "0": ProviderLevel.LEVEL_0,
        "1": ProviderLevel.LEVEL_1,
        "2": ProviderLevel.LEVEL_2,
        "3": ProviderLevel.LEVEL_3,
    }
    if level not in mapping:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid level (must be 0-3). L4/Emergency no longer exists.",
        )
    return mapping[level]


# Niveles cuyo acceso se abre con una credencial que coincide con el servicio.
_CREDENTIAL_GATED_LEVELS = {ProviderLevel.LEVEL_2, ProviderLevel.LEVEL_3}


async def _load_task_questions(
    db: AsyncSession, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """Preguntas activas por servicio, en UNA query para todo el catálogo.

    Cargarlas por servicio dentro del bucle haría 200+ consultas al abrir la
    pantalla de Servicios.
    """
    if not task_ids:
        return {}
    rows = (
        await db.execute(
            select(ServiceTaskQuestion)
            .where(
                ServiceTaskQuestion.task_id.in_(task_ids),
                ServiceTaskQuestion.is_active.is_(True),
            )
            .order_by(ServiceTaskQuestion.display_order)
        )
    ).scalars().all()
    out: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for q in rows:
        out.setdefault(q.task_id, []).append({
            "id": str(q.id),
            "questionEn": q.question_en,
            "questionFr": q.question_fr,
            "answerType": q.answer_type,
            "options": q.options or [],
            "isRequired": q.is_required,
            "displayOrder": q.display_order,
        })
    return out


async def _load_task_requirements(
    db: AsyncSession, task_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[dict[str, Any]]]:
    """Requisitos de credencial agrupados por servicio, en una sola query."""
    if not task_ids:
        return {}
    rows = (
        await db.execute(
            select(ServiceCredentialRequirement, CredentialRequirement)
            .join(
                CredentialRequirement,
                CredentialRequirement.code == ServiceCredentialRequirement.code,
            )
            .where(ServiceCredentialRequirement.task_id.in_(task_ids))
            .order_by(
                ServiceCredentialRequirement.mandatory.desc(),
                ServiceCredentialRequirement.code,
            )
        )
    ).all()

    out: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for link, req in rows:
        out.setdefault(link.task_id, []).append(
            {
                "code": link.code,
                "mandatory": link.mandatory,
                "kind": req.kind,
                "labelEn": req.label_en,
                "labelFr": req.label_fr,
                "authority": req.authority,
                "notes": link.notes,
            }
        )
    return out


async def _replace_task_requirements(
    db: AsyncSession,
    task: ServiceTask,
    items: list["TaskCredentialRequirementIn"],
) -> None:
    """Reemplaza el conjunto de requisitos de un servicio (borra + inserta)."""
    codes = [i.code.strip() for i in items if i.code and i.code.strip()]
    if codes:
        known = set(
            (
                await db.execute(
                    select(CredentialRequirement.code).where(
                        CredentialRequirement.code.in_(codes)
                    )
                )
            )
            .scalars()
            .all()
        )
        unknown = sorted(set(codes) - known)
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown credential requirement code(s): {', '.join(unknown)}",
            )

    await db.execute(
        delete(ServiceCredentialRequirement).where(
            ServiceCredentialRequirement.task_id == task.id
        )
    )
    seen: set[str] = set()
    for item in items:
        code = (item.code or "").strip()
        if not code or code in seen:
            continue
        seen.add(code)
        db.add(
            ServiceCredentialRequirement(
                task_id=task.id,
                code=code,
                mandatory=item.mandatory,
                notes=(item.notes or None),
            )
        )


# Código del catálogo que representa el seguro de responsabilidad civil. El
# checkbox "requiere seguro" del admin escribe/borra ESTA fila en
# `service_credential_requirements` en vez de usar una columna booleana aparte:
# así el motor consulta un único sitio y no puede haber dos fuentes que se
# contradigan (ver CLAUDE.md, regla 1).
_INSURANCE_CODE = "CGL"


async def _sync_insurance_requirement(
    db: AsyncSession, task: ServiceTask, requires: bool
) -> None:
    """Enciende o apaga el requisito de seguro del servicio."""
    existing = (
        await db.execute(
            select(ServiceCredentialRequirement).where(
                ServiceCredentialRequirement.task_id == task.id,
                ServiceCredentialRequirement.code == _INSURANCE_CODE,
            )
        )
    ).scalar_one_or_none()

    if requires and existing is None:
        db.add(
            ServiceCredentialRequirement(
                task_id=task.id, code=_INSURANCE_CODE, mandatory=True
            )
        )
    elif not requires and existing is not None:
        await db.delete(existing)


def _clean_options(item: "TaskQuestionIn") -> list[dict[str, Any]]:
    """Normaliza y valida las opciones de una pregunta cerrada.

    Una pregunta de opción con menos de dos opciones es un callejón sin salida:
    el cliente no podría contestarla y la reserva quedaría bloqueada sin que él
    pueda hacer nada. Se rechaza aquí con un 400 claro además del CHECK de la BD.
    """
    if item.answer_type != "SINGLE_CHOICE":
        return []
    limpias: list[dict[str, Any]] = []
    vistas: set[str] = set()
    for o in item.options or []:
        en = str((o or {}).get("en", "")).strip()
        if not en or en in vistas:
            continue
        vistas.add(en)
        fr = str((o or {}).get("fr", "")).strip()
        limpias.append({"en": en, "fr": fr} if fr else {"en": en})
    if len(limpias) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f'The question "{item.question_en}" is set to predefined answers, '
                f"so it needs at least two distinct options."
            ),
        )
    return limpias


async def _replace_task_questions(
    db: AsyncSession, task: ServiceTask, incoming: list["TaskQuestionIn"]
) -> None:
    """Sincroniza las preguntas del servicio con lo que manda el admin.

    Las que desaparecen se DESACTIVAN, no se borran: las respuestas ya guardadas
    en `jobs.customer_answers_json` apuntan a su id, y borrarlas dejaría jobs
    históricos sin poder explicar a qué respondió el cliente.
    """
    actuales = {
        q.id: q
        for q in (
            await db.execute(
                select(ServiceTaskQuestion).where(
                    ServiceTaskQuestion.task_id == task.id
                )
            )
        ).scalars().all()
    }

    vistos: set[uuid.UUID] = set()
    for idx, item in enumerate(incoming):
        texto = (item.question_en or "").strip()
        if not texto:
            continue
        if item.id and item.id in actuales:
            q = actuales[item.id]
            q.question_en = texto
            q.question_fr = (item.question_fr or "").strip() or None
            q.answer_type = item.answer_type
            q.options = _clean_options(item)
            q.is_required = item.is_required
            q.display_order = item.display_order or idx
            q.is_active = True
            vistos.add(q.id)
        else:
            db.add(
                ServiceTaskQuestion(
                    task_id=task.id,
                    question_en=texto,
                    question_fr=(item.question_fr or "").strip() or None,
                    answer_type=item.answer_type,
                    options=_clean_options(item),
                    is_required=item.is_required,
                    display_order=item.display_order or idx,
                    is_active=True,
                )
            )

    for qid, q in actuales.items():
        if qid not in vistos and q.is_active:
            q.is_active = False


def _assert_details_prompt(task: ServiceTask) -> None:
    """Guardarraíl: detalles obligatorios exigen un prompt para ese servicio.

    El prompt por servicio es lo que mantiene el campo de texto libre DENTRO de la
    regla del catálogo cerrado: guía al cliente a describir escala y acceso del
    servicio ya elegido ("¿cuántas habitaciones y baños? ¿mascotas? ¿acceso?") en
    vez de pedir tareas nuevas. Una caja de texto en blanco y obligatoria es la
    forma más directa de que aparezcan peticiones que nadie cotizó.

    Se evalúa sobre el estado RESULTANTE, igual que el gate de credenciales, para
    que encender `requiresDetails` sin prompt también quede bloqueado.
    """
    if task.requires_details and not (task.details_prompt_en or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "A service that requires details also needs 'detailsPromptEn': it is "
                "what tells the customer to describe the scale and access of THIS "
                "service instead of asking for extra work."
            ),
        )


async def _assert_credential_gate(
    db: AsyncSession, task: ServiceTask, pending: Optional[list["TaskCredentialRequirementIn"]]
) -> None:
    """Guardarraíl: un servicio L2/L3 sin requisitos de credencial es un servicio
    muerto — nadie podría calificarlo nunca y nadie entendería por qué no aparece."""
    if task.level not in _CREDENTIAL_GATED_LEVELS:
        return
    if pending is not None:
        count = len([i for i in pending if i.code and i.code.strip()])
    else:
        count = (
            await db.execute(
                select(func.count())
                .select_from(ServiceCredentialRequirement)
                .where(ServiceCredentialRequirement.task_id == task.id)
            )
        ).scalar_one()
    if count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "A Level 2 or Level 3 service must declare at least one credential "
                "requirement, otherwise no provider can ever qualify for it."
            ),
        )


_REQUIREMENT_KINDS = ("CREDENTIAL", "INSURANCE", "PERMIT")
_VERIFICATION_METHODS = ("REGISTRY", "DOCUMENT", "SELF_DECLARED")


class CredentialRequirementCreate(_CamelModel):
    # El código es la PK y lo referencian service_credential_requirements y
    # provider_credential_codes: se fija al crear y no se puede cambiar después.
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Z0-9_]+$")
    label_en: str = Field(min_length=1, max_length=200)
    label_fr: Optional[str] = Field(default=None, max_length=200)
    kind: str = "CREDENTIAL"
    authority: Optional[str] = Field(default=None, max_length=200)
    registry_name: Optional[str] = Field(default=None, max_length=200)
    registry_url: Optional[str] = None
    verification_method: str = "DOCUMENT"
    description: Optional[str] = None
    is_active: bool = True


class CredentialRequirementUpdate(_CamelModel):
    label_en: Optional[str] = Field(default=None, min_length=1, max_length=200)
    label_fr: Optional[str] = Field(default=None, max_length=200)
    kind: Optional[str] = None
    authority: Optional[str] = Field(default=None, max_length=200)
    registry_name: Optional[str] = Field(default=None, max_length=200)
    registry_url: Optional[str] = None
    verification_method: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


def _requirement_to_out(r: CredentialRequirement, usage: int = 0) -> dict[str, Any]:
    return {
        "code": r.code,
        "kind": r.kind,
        "labelEn": r.label_en,
        "labelFr": r.label_fr,
        "authority": r.authority,
        "registryName": r.registry_name,
        "registryUrl": r.registry_url,
        "verificationMethod": r.verification_method,
        "description": r.description,
        "isActive": r.is_active,
        # Cuántos servicios lo exigen — evita borrar algo que está en uso.
        "usageCount": usage,
    }


def _validate_requirement_enums(kind: Optional[str], method: Optional[str]) -> None:
    if kind is not None and kind not in _REQUIREMENT_KINDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid kind. Must be one of: {', '.join(_REQUIREMENT_KINDS)}.",
        )
    if method is not None and method not in _VERIFICATION_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid verificationMethod. Must be one of: {', '.join(_VERIFICATION_METHODS)}.",
        )


async def _requirement_usage(db: AsyncSession) -> dict[str, int]:
    """Cuántos servicios exigen cada código."""
    rows = (
        await db.execute(
            select(
                ServiceCredentialRequirement.code,
                func.count(ServiceCredentialRequirement.id),
            ).group_by(ServiceCredentialRequirement.code)
        )
    ).all()
    return {code: count for code, count in rows}


@router.get("/taxonomy/credential-requirements")
async def admin_credential_requirements(
    db: DBSession,
    _: CurrentAdmin,
    include_inactive: bool = Query(default=False),
) -> dict[str, Any]:
    """Catálogo de requisitos: credenciales de oficio, seguros y permisos."""
    stmt = select(CredentialRequirement)
    if not include_inactive:
        stmt = stmt.where(CredentialRequirement.is_active.is_(True))
    rows = (
        await db.execute(stmt.order_by(CredentialRequirement.kind, CredentialRequirement.code))
    ).scalars().all()
    usage = await _requirement_usage(db)
    return {"data": [_requirement_to_out(r, usage.get(r.code, 0)) for r in rows]}


@router.post("/taxonomy/credential-requirements", status_code=status.HTTP_201_CREATED)
async def admin_create_credential_requirement(
    db: DBSession,
    _: CurrentAdmin,
    body: CredentialRequirementCreate,
) -> dict[str, Any]:
    _validate_requirement_enums(body.kind, body.verification_method)
    code = body.code.strip().upper()

    exists = (
        await db.execute(select(CredentialRequirement).where(CredentialRequirement.code == code))
    ).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A requirement with code '{code}' already exists.",
        )

    req = CredentialRequirement(
        code=code,
        label_en=body.label_en.strip(),
        label_fr=(body.label_fr or "").strip() or None,
        kind=body.kind,
        authority=(body.authority or "").strip() or None,
        registry_name=(body.registry_name or "").strip() or None,
        registry_url=(body.registry_url or "").strip() or None,
        verification_method=body.verification_method,
        description=(body.description or "").strip() or None,
        is_active=body.is_active,
    )
    db.add(req)
    try:
        await db.commit()
        await db.refresh(req)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not create requirement: {exc}",
        )
    return {"data": _requirement_to_out(req)}


@router.patch("/taxonomy/credential-requirements/{code}")
async def admin_update_credential_requirement(
    db: DBSession,
    _: CurrentAdmin,
    code: str,
    body: CredentialRequirementUpdate,
) -> dict[str, Any]:
    req = (
        await db.execute(select(CredentialRequirement).where(CredentialRequirement.code == code))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found.")

    payload = body.model_dump(exclude_unset=True)
    _validate_requirement_enums(payload.get("kind"), payload.get("verification_method"))

    for field, value in payload.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(req, field, value)

    try:
        await db.commit()
        await db.refresh(req)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not update requirement: {exc}",
        )
    usage = await _requirement_usage(db)
    return {"data": _requirement_to_out(req, usage.get(req.code, 0))}


@router.delete("/taxonomy/credential-requirements/{code}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_credential_requirement(
    db: DBSession,
    _: CurrentAdmin,
    code: str,
) -> None:
    req = (
        await db.execute(select(CredentialRequirement).where(CredentialRequirement.code == code))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found.")

    # Borrarlo dejaría servicios L2/L3 sin ningún requisito, es decir
    # inalcanzables para todo proveedor. Se desactiva, no se borra.
    in_use = (
        await db.execute(
            select(func.count())
            .select_from(ServiceCredentialRequirement)
            .where(ServiceCredentialRequirement.code == code)
        )
    ).scalar_one()
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"'{code}' is required by {in_use} service(s) and cannot be deleted. "
                "Remove it from those services first, or deactivate it instead."
            ),
        )

    await db.delete(req)
    await db.commit()


@router.post("/taxonomy/tasks", status_code=status.HTTP_201_CREATED)
async def admin_create_task(
    db: DBSession,
    _: CurrentAdmin,
    body: TaskAdminCreate,
) -> dict[str, Any]:
    # Ensure category exists
    cat = (
        await db.execute(select(ServiceCategory).where(ServiceCategory.id == body.category_id))
    ).scalar_one_or_none()
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    task = ServiceTask(
        category_id=body.category_id,
        slug=body.slug,
        name=body.name,
        description=body.description,
        level=_parse_level(body.level),
        regulated=body.regulated,
        license_required=body.license_required,
        certification_required=body.certification_required,
        hazardous=body.hazardous,
        structural=body.structural,
        emergency_eligible=body.emergency_eligible,
        base_price_min_cents=body.base_price_min_cents,
        base_price_max_cents=body.base_price_max_cents,
        estimated_duration_min=body.estimated_duration_min,
        pricing_unit=_parse_pricing_unit(body.pricing_unit or "hourly"),
        allows_quantity=body.allows_quantity,
        requires_details=body.requires_details,
        requires_evidence=body.requires_evidence,
        details_prompt_en=(body.details_prompt_en or None),
        details_prompt_fr=(body.details_prompt_fr or None),
        min_quantity=body.min_quantity if body.min_quantity is not None else 1,
        escalation_keywords=body.escalation_keywords,
        icon_url=body.icon_url,
        display_order=body.display_order,
        is_active=body.is_active,
    )
    # Guardarraíl: L2/L3 sin requisitos = servicio que nadie puede tomar nunca.
    await _assert_credential_gate(db, task, body.credential_requirements)
    _assert_details_prompt(task)

    db.add(task)
    try:
        await db.flush()
        await _replace_task_requirements(db, task, body.credential_requirements)
        await _replace_task_questions(db, task, body.questions)
        await _sync_insurance_requirement(db, task, body.requires_insurance)
        await db.commit()
        await db.refresh(task)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not create service: {exc}",
        )
    return {"data": _task_to_out(
        task,
        (await _load_task_requirements(db, [task.id])).get(task.id),
        (await _load_task_questions(db, [task.id])).get(task.id),
    )}


@router.patch("/taxonomy/tasks/{task_id}")
async def admin_update_task(
    db: DBSession,
    _: CurrentAdmin,
    task_id: uuid.UUID,
    body: TaskAdminUpdate,
) -> dict[str, Any]:
    task = (
        await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")

    payload = body.model_dump(exclude_unset=True)

    # Estos tres no son columnas de `service_tasks`: se manejan aparte.
    payload.pop("credential_requirements", None)
    payload.pop("questions", None)
    payload.pop("requires_insurance", None)

    if "level" in payload and payload["level"] is not None:
        payload["level"] = _parse_level(payload["level"])

    if "pricing_unit" in payload and payload["pricing_unit"] is not None:
        payload["pricing_unit"] = _parse_pricing_unit(payload["pricing_unit"])

    # Verify new category id if changing
    if "category_id" in payload and payload["category_id"] is not None:
        cat = (
            await db.execute(select(ServiceCategory).where(ServiceCategory.id == payload["category_id"]))
        ).scalar_one_or_none()
        if cat is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    for field, value in payload.items():
        setattr(task, field, value)

    # El guardarraíl se evalúa sobre el nivel RESULTANTE: subir un servicio a
    # L2/L3 sin requisitos lo dejaría inalcanzable para todo proveedor.
    await _assert_credential_gate(db, task, body.credential_requirements)
    _assert_details_prompt(task)

    try:
        if body.credential_requirements is not None:
            await _replace_task_requirements(db, task, body.credential_requirements)
        if body.questions is not None:
            await _replace_task_questions(db, task, body.questions)
        if body.requires_insurance is not None:
            await _sync_insurance_requirement(db, task, body.requires_insurance)
        await db.commit()
        await db.refresh(task)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Could not update service: {exc}")
    return {"data": _task_to_out(
        task,
        (await _load_task_requirements(db, [task.id])).get(task.id),
        (await _load_task_questions(db, [task.id])).get(task.id),
    )}


@router.delete("/taxonomy/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def admin_delete_task(
    db: DBSession,
    _: CurrentAdmin,
    task_id: uuid.UUID,
) -> None:
    task = (
        await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")
    await db.delete(task)
    await db.commit()


# ---------------------------------------------------------------------------
# VISP for Business — company validation (SP3 backend)
# ---------------------------------------------------------------------------

@router.get("/companies")
async def admin_list_companies(db: DBSession, admin: CurrentAdmin, status: str | None = None):
    companies = await company_service.list_companies_by_status(db, status)
    return {"data": [
        {"id": str(c.id), "legal_name": c.legal_name, "status": c.status.value,
         "created_at": c.created_at.isoformat()}
        for c in companies
    ]}


@router.get("/companies/{company_id}")
async def admin_get_company(db: DBSession, admin: CurrentAdmin, company_id: str):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    return {"data": {
        "id": str(company.id), "legal_name": company.legal_name,
        "trade_name": company.trade_name, "status": company.status.value,
        "business_address": company.business_address, "phone": company.phone,
        "email": company.email, "website": company.website,
        "rejection_reason": company.rejection_reason,
        "documents": [
            {"id": str(d.id), "doc_type": d.doc_type.value, "status": d.status.value,
             "document_url": d.document_url, "rejection_reason": d.rejection_reason}
            for d in company.documents
        ],
    }}


@router.post("/companies/documents/{doc_id}/approve")
async def admin_approve_document(db: DBSession, admin: CurrentAdmin, doc_id: str):
    import uuid as _uuid
    try:
        doc = await company_service.review_document(db, _uuid.UUID(doc_id), admin.id, approve=True, reason=None)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"data": {"id": str(doc.id), "status": doc.status.value}}


@router.post("/companies/documents/{doc_id}/reject")
async def admin_reject_document(db: DBSession, admin: CurrentAdmin, doc_id: str, payload: RejectIn):
    import uuid as _uuid
    try:
        doc = await company_service.review_document(db, _uuid.UUID(doc_id), admin.id, approve=False, reason=payload.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"data": {"id": str(doc.id), "status": doc.status.value, "rejection_reason": doc.rejection_reason}}


@router.post("/companies/{company_id}/validate")
async def admin_validate_company(db: DBSession, admin: CurrentAdmin, company_id: str):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    try:
        company = await company_service.set_company_validation(db, company, validated=True, reason=None)
    except ValueError as exc:
        # e.g. documents not all approved — user-facing 400 (not 5xx, Cloudflare).
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": {"status": company.status.value}}


@router.post("/companies/{company_id}/reject")
async def admin_reject_company(db: DBSession, admin: CurrentAdmin, company_id: str, payload: RejectIn):
    import uuid as _uuid
    company = await company_service.get_company(db, _uuid.UUID(company_id))
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    company = await company_service.set_company_validation(db, company, validated=False, reason=payload.reason)
    return {"data": {"status": company.status.value, "rejection_reason": company.rejection_reason}}
