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
    if db_user.default_address_formatted or db_user.default_address_latitude is not None or db_user.default_address_street:
        default_address = {
            "street": db_user.default_address_street or "",
            "city": db_user.default_address_city or "",
            "province": db_user.default_address_province or "",
            "postalCode": db_user.default_address_postal_code or "",
            "country": db_user.default_address_country or "CA",
            "latitude": float(db_user.default_address_latitude) if db_user.default_address_latitude is not None else None,
            "longitude": float(db_user.default_address_longitude) if db_user.default_address_longitude is not None else None,
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

    try:
        stmt = select(User).where(User.id == user.id)
        db_user = (await db.execute(stmt)).scalar_one_or_none()
        if not db_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found.",
            )

        if body.firstName is not None:
            stripped_first = body.firstName.strip()
            if stripped_first:
                db_user.first_name = stripped_first
                
        if body.lastName is not None:
            stripped_last = body.lastName.strip()
            if stripped_last:
                db_user.last_name = stripped_last
                
        if body.phone is not None:
            stripped_phone = body.phone.strip()
            if stripped_phone:
                db_user.phone = stripped_phone

        # Save default address
        if body.defaultAddress is not None:
            addr = body.defaultAddress
            # Map full country names to ISO codes (DB column is VARCHAR(5))
            _COUNTRY_MAP = {
                "mexico": "MX", "méxico": "MX", "mx": "MX",
                "canada": "CA", "ca": "CA",
                "united states": "US", "usa": "US", "us": "US",
                "united states of america": "US",
                "estados unidos": "US",
            }
            raw_country = (addr.country or "MX").strip()
            country_code = _COUNTRY_MAP.get(raw_country.lower(), raw_country[:5])

            # Safely truncate text fields to fit database schema limits to avoid 500 DB errors
            db_user.default_address_street = addr.street[:255] if addr.street else None
            db_user.default_address_city = addr.city[:100] if addr.city else None
            db_user.default_address_province = addr.province[:50] if addr.province else None
            db_user.default_address_postal_code = addr.postalCode[:20] if addr.postalCode else None
            db_user.default_address_country = country_code[:5]
            db_user.default_address_latitude = addr.latitude
            db_user.default_address_longitude = addr.longitude
            db_user.default_address_formatted = addr.formattedAddress[:500] if addr.formattedAddress else None

            # Also update ProviderProfile home location for matching engine
            if addr.latitude is not None and addr.longitude is not None:
                try:
                    from src.models.provider import ProviderProfile
                    provider_stmt = select(ProviderProfile).where(
                        ProviderProfile.user_id == user.id
                    )
                    provider = (await db.execute(provider_stmt)).scalar_one_or_none()
                    if provider:
                        provider.home_latitude = addr.latitude
                        provider.home_longitude = addr.longitude
                        logger.info(
                            "Updated provider %s home location: lat=%s, lng=%s",
                            provider.id, addr.latitude, addr.longitude,
                        )
                except Exception as prov_exc:
                    logger.warning("Could not update provider location: %s", prov_exc)

        try:
            await db.commit()
            await db.refresh(db_user)
        except Exception as db_exc:
            await db.rollback()
            logger.error("DB commit failed updating user (Did you run make db-migrate?): %s", db_exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Update error. Confirme que su base de datos local aplicó las migraciones (make db-migrate).",
            )

        return {"data": _build_user_response(db_user)}

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        error_tb = traceback.format_exc()
        logger.error("update_me FAILED: %s\n%s", exc, error_tb)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"update_me error: {type(exc).__name__}: {exc}",
        )


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
    from src.core.config import settings

    if not settings.stripe_secret_key:
        raise HTTPException(status_code=500, detail="Stripe integration is missing API keys")
    stripe.api_key = settings.stripe_secret_key

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

    # Create SetupIntent and auto-heal invalid customer IDs (like after sandbox resets)
    try:
        setup_intent = stripe.SetupIntent.create(
            customer=db_user.stripe_customer_id,
            automatic_payment_methods={"enabled": True},
        )
    except stripe.error.InvalidRequestError as e:
        if "No such customer" in str(e):
            logger.warning("Stripe customer %s not found. Healing by creating a new one...", db_user.stripe_customer_id)
            try:
                # Create a fresh customer
                customer = stripe.Customer.create(
                    email=db_user.email,
                    name=f"{db_user.first_name} {db_user.last_name}",
                    metadata={"visp_user_id": str(db_user.id)},
                )
                db_user.stripe_customer_id = customer.id
                await db.commit()
                # Retry SetupIntent creation
                setup_intent = stripe.SetupIntent.create(
                    customer=db_user.stripe_customer_id,
                    automatic_payment_methods={"enabled": True},
                )
            except Exception as e_inner:
                logger.error("Failed to auto-heal Stripe customer: %s", e_inner)
                raise HTTPException(status_code=500, detail="Failed to initialize card setup")
        else:
            logger.error("Failed to create SetupIntent: %s", e)
            raise HTTPException(status_code=500, detail="Failed to initialize card setup")
    except Exception as e:
        logger.error("Failed to create SetupIntent: %s", e)
        raise HTTPException(status_code=500, detail="Failed to initialize card setup")

    return {
        "data": {
            "clientSecret": setup_intent.client_secret,
            "customerId": db_user.stripe_customer_id,
            "setupIntentId": setup_intent.id,
        }
    }


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
