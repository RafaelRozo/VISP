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
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status

logger = logging.getLogger(__name__)
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from src.api.deps import CurrentAdmin, DBSession
from src.models.job import Job, JobAssignment, JobStatus
from src.models.promotion import Promotion
from src.models.provider import ProviderLevel, ProviderProfile
from src.models.user import User
from src.models.taxonomy import ServiceCategory, ServiceTask
from src.models.verification import (
    CredentialStatus,
    ProviderCredential,
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
    stmt = (
        select(ProviderCredential, ProviderProfile, User, ServiceTask, ServiceCategory)
        .join(ProviderProfile, ProviderProfile.id == ProviderCredential.provider_id)
        .join(User, User.id == ProviderProfile.user_id)
        .outerjoin(ServiceTask, ServiceTask.id == ProviderCredential.task_id)
        .outerjoin(ServiceCategory, ServiceCategory.id == ServiceTask.category_id)
        .where(ProviderCredential.status == CredentialStatus.PENDING_REVIEW)
        .order_by(ProviderCredential.created_at.asc())
    )
    rows = (await db.execute(stmt)).all()
    items = []
    for cred, profile, user, task, category in rows:
        items.append({
            "id": str(cred.id),
            "credentialType": cred.credential_type.value,
            "name": cred.name,
            "documentUrl": cred.document_url,
            "uploadedAt": cred.created_at.isoformat() if cred.created_at else None,
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
    cred.status = CredentialStatus.VERIFIED
    cred.verified_at = datetime.now(timezone.utc)
    # NOTE: `verified_by` is FK to users.id and superusers live in a separate
    # table. Audit which admin acted on the credential will live in a future
    # dedicated audit_log table.
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
    await db.commit()
    return {"data": {"id": str(cred.id), "status": cred.status.value}}


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


class CategoryAdminUpdate(_CamelModel):
    slug: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    icon_url: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None
    parent_id: Optional[uuid.UUID] = None


class TaskAdminCreate(_CamelModel):
    category_id: uuid.UUID
    slug: str = Field(min_length=1, max_length=150)
    name: str = Field(min_length=1, max_length=300)
    description: Optional[str] = None
    level: str = Field(pattern=r"^[1-4]$")
    regulated: bool = False
    license_required: bool = False
    certification_required: bool = False
    hazardous: bool = False
    structural: bool = False
    emergency_eligible: bool = False
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None
    escalation_keywords: list[str] = Field(default_factory=list)
    icon_url: Optional[str] = None
    display_order: int = 0
    is_active: bool = True


class TaskAdminUpdate(_CamelModel):
    category_id: Optional[uuid.UUID] = None
    slug: Optional[str] = Field(default=None, min_length=1, max_length=150)
    name: Optional[str] = Field(default=None, min_length=1, max_length=300)
    description: Optional[str] = None
    level: Optional[str] = Field(default=None, pattern=r"^[1-4]$")
    regulated: Optional[bool] = None
    license_required: Optional[bool] = None
    certification_required: Optional[bool] = None
    hazardous: Optional[bool] = None
    structural: Optional[bool] = None
    emergency_eligible: Optional[bool] = None
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    estimated_duration_min: Optional[int] = None
    escalation_keywords: Optional[list[str]] = None
    icon_url: Optional[str] = None
    display_order: Optional[int] = None
    is_active: Optional[bool] = None


def _level_value(level: Any) -> str:
    """Return the numeric string ('1'..'4') from a ProviderLevel enum or raw value."""
    if hasattr(level, "value"):
        return str(level.value)
    return str(level)


def _task_to_out(t: ServiceTask) -> dict[str, Any]:
    return {
        "id": str(t.id),
        "categoryId": str(t.category_id),
        "slug": t.slug,
        "name": t.name,
        "description": t.description,
        "level": _level_value(t.level),
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
        "iconUrl": t.icon_url,
        "displayOrder": t.display_order,
        "isActive": t.is_active,
        "createdAt": t.created_at.isoformat() if t.created_at else None,
        "updatedAt": t.updated_at.isoformat() if t.updated_at else None,
    }


def _category_to_out(c: ServiceCategory, tasks: Optional[list[ServiceTask]] = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": str(c.id),
        "slug": c.slug,
        "name": c.name,
        "description": c.description,
        "iconUrl": c.icon_url,
        "displayOrder": c.display_order,
        "isActive": c.is_active,
        "parentId": str(c.parent_id) if c.parent_id else None,
        "createdAt": c.created_at.isoformat() if c.created_at else None,
        "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
    }
    if tasks is not None:
        out["tasks"] = [_task_to_out(t) for t in tasks]
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

    data: list[dict[str, Any]] = []
    for c in cats:
        tasks_sorted = sorted(
            c.tasks,
            key=lambda t: (t.display_order, t.name),
        )
        data.append(_category_to_out(c, tasks_sorted))
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
    mapping = {
        "1": ProviderLevel.LEVEL_1,
        "2": ProviderLevel.LEVEL_2,
        "3": ProviderLevel.LEVEL_3,
        "4": ProviderLevel.LEVEL_4,
    }
    if level not in mapping:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid level (must be 1-4).")
    return mapping[level]


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
        escalation_keywords=body.escalation_keywords,
        icon_url=body.icon_url,
        display_order=body.display_order,
        is_active=body.is_active,
    )
    db.add(task)
    try:
        await db.commit()
        await db.refresh(task)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Could not create service: {exc}",
        )
    return {"data": _task_to_out(task)}


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

    if "level" in payload and payload["level"] is not None:
        payload["level"] = _parse_level(payload["level"])

    # Verify new category id if changing
    if "category_id" in payload and payload["category_id"] is not None:
        cat = (
            await db.execute(select(ServiceCategory).where(ServiceCategory.id == payload["category_id"]))
        ).scalar_one_or_none()
        if cat is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")

    for field, value in payload.items():
        setattr(task, field, value)

    try:
        await db.commit()
        await db.refresh(task)
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Could not update service: {exc}")
    return {"data": _task_to_out(task)}


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
