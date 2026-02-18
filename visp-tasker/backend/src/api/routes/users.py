"""
User profile update routes.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from src.api.deps import CurrentUser, DBSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["Users"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class DefaultAddressRequest(BaseModel):
    """Address object for profile save."""
    street: Optional[str] = None
    city: Optional[str] = None
    province: Optional[str] = None
    postalCode: Optional[str] = None
    country: Optional[str] = "CA"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    formattedAddress: Optional[str] = None


class UserUpdateRequest(BaseModel):
    """Request body for updating user profile fields."""
    firstName: Optional[str] = None
    lastName: Optional[str] = None
    phone: Optional[str] = None
    defaultAddress: Optional[DefaultAddressRequest] = None


class LocationUpdateRequest(BaseModel):
    """Request body for updating user location."""
    latitude: float
    longitude: float


class SetupIntentRequest(BaseModel):
    """Request body for creating a Stripe SetupIntent."""
    pass  # No extra fields needed; user is derived from auth token


class AttachPaymentMethodRequest(BaseModel):
    """Request body for attaching a payment method."""
    paymentMethodId: str = Field(description="Stripe payment method ID (pm_...)")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_user_response(db_user: Any) -> dict[str, Any]:
    """Build a standardized user response dict."""
    roles = []
    if db_user.role_customer:
        roles.append("customer")
    if db_user.role_provider:
        roles.append("provider")
    role_str = "both" if len(roles) > 1 else (roles[0] if roles else "customer")

    default_address = None
    if db_user.default_address_city or db_user.default_address_street:
        default_address = {
            "street": db_user.default_address_street or "",
            "city": db_user.default_address_city or "",
            "province": db_user.default_address_province or "",
            "postalCode": db_user.default_address_postal_code or "",
            "country": db_user.default_address_country or "CA",
            "latitude": float(db_user.default_address_latitude) if db_user.default_address_latitude else None,
            "longitude": float(db_user.default_address_longitude) if db_user.default_address_longitude else None,
            "formattedAddress": db_user.default_address_formatted or "",
        }

    return {
        "id": str(db_user.id),
        "email": db_user.email,
        "firstName": db_user.first_name,
        "lastName": db_user.last_name,
        "phone": db_user.phone or "",
        "role": role_str,
        "avatarUrl": db_user.avatar_url,
        "isVerified": db_user.email_verified or db_user.phone_verified,
        "defaultAddress": default_address,
        "stripeCustomerId": db_user.stripe_customer_id,
        "createdAt": db_user.created_at.isoformat() if db_user.created_at else None,
        "updatedAt": db_user.updated_at.isoformat() if db_user.updated_at else None,
    }


# ---------------------------------------------------------------------------
# PATCH /users/me
# ---------------------------------------------------------------------------

@router.patch(
    "/me",
    summary="Update current user profile",
    description="Update the authenticated user's profile fields (name, phone, address).",
)
async def update_me(
    db: DBSession,
    user: CurrentUser,
    body: UserUpdateRequest,
) -> dict[str, Any]:
    from src.models.user import User
    from sqlalchemy import select

    stmt = select(User).where(User.id == user.id)
    db_user = (await db.execute(stmt)).scalar_one_or_none()
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    if body.firstName is not None:
        db_user.first_name = body.firstName
    if body.lastName is not None:
        db_user.last_name = body.lastName
    if body.phone is not None:
        db_user.phone = body.phone

    # Save default address
    if body.defaultAddress is not None:
        addr = body.defaultAddress
        db_user.default_address_street = addr.street
        db_user.default_address_city = addr.city
        db_user.default_address_province = addr.province
        db_user.default_address_postal_code = addr.postalCode
        db_user.default_address_country = addr.country or "CA"
        db_user.default_address_latitude = addr.latitude
        db_user.default_address_longitude = addr.longitude
        db_user.default_address_formatted = addr.formattedAddress

    await db.commit()
    await db.refresh(db_user)

    return {"data": _build_user_response(db_user)}


# ---------------------------------------------------------------------------
# POST /users/me/location
# ---------------------------------------------------------------------------

@router.post(
    "/me/location",
    summary="Update current user location",
    description="Save the user's current GPS position. Also updates provider home location if applicable.",
)
async def update_my_location(
    db: DBSession,
    user: CurrentUser,
    body: LocationUpdateRequest,
) -> dict[str, Any]:
    from src.models.user import User
    from src.models.provider import ProviderProfile
    from sqlalchemy import select

    # Update user's last known location
    stmt = select(User).where(User.id == user.id)
    db_user = (await db.execute(stmt)).scalar_one_or_none()
    if db_user:
        db_user.last_latitude = body.latitude
        db_user.last_longitude = body.longitude

    # If user is a provider, also update provider profile home location
    provider_stmt = select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    provider = (await db.execute(provider_stmt)).scalar_one_or_none()
    if provider:
        provider.home_latitude = body.latitude
        provider.home_longitude = body.longitude

    await db.commit()

    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# GET /users/me/payment-methods
# ---------------------------------------------------------------------------

@router.get(
    "/me/payment-methods",
    summary="List saved payment methods",
    description="Returns the customer's saved Stripe payment methods.",
)
async def list_my_payment_methods(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.models.user import User
    from sqlalchemy import select

    stmt = select(User).where(User.id == user.id)
    db_user = (await db.execute(stmt)).scalar_one_or_none()

    if not db_user or not db_user.stripe_customer_id:
        return {"data": {"methods": []}}

    try:
        from src.integrations.stripe.paymentService import list_payment_methods
        methods = await list_payment_methods(db_user.stripe_customer_id)

        result = []
        for m in methods:
            card = m.get("card", {}) if isinstance(m, dict) else {}
            if hasattr(m, "card") and m.card:
                card = {
                    "brand": m.card.brand,
                    "last4": m.card.last4,
                    "exp_month": m.card.exp_month,
                    "exp_year": m.card.exp_year,
                }
            result.append({
                "id": m.get("id", "") if isinstance(m, dict) else m.id,
                "brand": card.get("brand", "unknown"),
                "last4": card.get("last4", "****"),
                "expMonth": card.get("exp_month", 0),
                "expYear": card.get("exp_year", 0),
                "isDefault": False,
            })

        return {"data": {"methods": result}}
    except Exception as e:
        logger.error("Failed to list payment methods: %s", e)
        return {"data": {"methods": []}}


# ---------------------------------------------------------------------------
# POST /users/me/payment-setup-intent
# ---------------------------------------------------------------------------

@router.post(
    "/me/payment-setup-intent",
    summary="Create a Stripe SetupIntent for card enrollment",
    description="Creates a SetupIntent so the mobile app can collect card details securely via Stripe SDK.",
)
async def create_setup_intent(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    import stripe
    from src.models.user import User
    from sqlalchemy import select

    stmt = select(User).where(User.id == user.id)
    db_user = (await db.execute(stmt)).scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Create or reuse Stripe customer
    if not db_user.stripe_customer_id:
        try:
            customer = stripe.Customer.create(
                email=db_user.email,
                name=f"{db_user.first_name} {db_user.last_name}",
                metadata={"visp_user_id": str(db_user.id)},
            )
            db_user.stripe_customer_id = customer.id
            await db.commit()
            await db.refresh(db_user)
        except Exception as e:
            logger.error("Failed to create Stripe customer: %s", e)
            raise HTTPException(status_code=500, detail="Failed to create payment customer")

    # Create SetupIntent
    try:
        setup_intent = stripe.SetupIntent.create(
            customer=db_user.stripe_customer_id,
            automatic_payment_methods={"enabled": True},
        )
        return {
            "data": {
                "clientSecret": setup_intent.client_secret,
                "customerId": db_user.stripe_customer_id,
                "setupIntentId": setup_intent.id,
            }
        }
    except Exception as e:
        logger.error("Failed to create SetupIntent: %s", e)
        raise HTTPException(status_code=500, detail="Failed to create setup intent")


# ---------------------------------------------------------------------------
# POST /users/me/payment-methods/attach
# ---------------------------------------------------------------------------

@router.post(
    "/me/payment-methods/attach",
    summary="Attach a payment method to the customer",
    description="After collecting card details via Stripe SDK, attach the payment method to the customer.",
)
async def attach_my_payment_method(
    db: DBSession,
    user: CurrentUser,
    body: AttachPaymentMethodRequest,
) -> dict[str, Any]:
    from src.models.user import User
    from sqlalchemy import select

    stmt = select(User).where(User.id == user.id)
    db_user = (await db.execute(stmt)).scalar_one_or_none()

    if not db_user or not db_user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer linked")

    try:
        from src.integrations.stripe.paymentService import attach_payment_method
        await attach_payment_method(
            customer_id=db_user.stripe_customer_id,
            payment_method_id=body.paymentMethodId,
        )
        return {"data": {"ok": True, "paymentMethodId": body.paymentMethodId}}
    except Exception as e:
        logger.error("Failed to attach payment method: %s", e)
        raise HTTPException(status_code=500, detail="Failed to attach payment method")
