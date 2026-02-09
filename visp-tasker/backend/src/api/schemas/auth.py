"""
Pydantic v2 schemas for authentication API endpoints.

All response models use camelCase field names to match what the React Native
mobile app expects.  This is achieved via Pydantic's ``alias_generator``
together with ``populate_by_name=True`` so both snake_case and camelCase
are accepted for construction.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _to_camel(name: str) -> str:
    """Convert a snake_case string to camelCase."""
    parts = name.split("_")
    return parts[0] + "".join(word.capitalize() for word in parts[1:])


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    """Request body for POST /auth/register."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    email: str = Field(..., description="User email address")
    password: str = Field(
        ..., min_length=8, max_length=128, description="Password (min 8 characters)"
    )
    first_name: str = Field(..., min_length=1, max_length=100, description="First name")
    last_name: str = Field(..., min_length=1, max_length=100, description="Last name")
    phone: Optional[str] = Field(None, max_length=20, description="Phone number")
    role: str = Field(
        ...,
        pattern=r"^(customer|provider|both)$",
        description="User role: customer, provider, or both",
    )


class LoginRequest(BaseModel):
    """Request body for POST /auth/login."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    email: str = Field(..., description="User email address")
    password: str = Field(..., description="Password")


class RefreshRequest(BaseModel):
    """Request body for POST /auth/refresh."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    refresh_token: str = Field(..., description="Refresh token")


class ForgotPasswordRequest(BaseModel):
    """Request body for POST /auth/forgot-password."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    email: str = Field(..., description="User email address")


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class UserOut(BaseModel):
    """Public user representation returned to clients.

    Uses camelCase field names to match mobile app expectations.
    """

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
        from_attributes=True,
    )

    id: uuid.UUID
    email: str
    phone: Optional[str] = None
    first_name: str
    last_name: str
    role: str = Field(description="customer, provider, or both")
    avatar_url: Optional[str] = None
    is_verified: bool = False
    created_at: datetime
    updated_at: datetime


class TokensOut(BaseModel):
    """JWT token pair returned after authentication."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    access_token: str
    refresh_token: str
    expires_at: datetime


class AuthResponse(BaseModel):
    """Response wrapper for login and register endpoints."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    data: AuthData
    message: Optional[str] = None


class AuthData(BaseModel):
    """Inner data object containing user and tokens."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    user: UserOut
    tokens: TokensOut


class TokenRefreshResponse(BaseModel):
    """Response wrapper for token refresh endpoint."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    data: TokenRefreshData
    message: Optional[str] = None


class TokenRefreshData(BaseModel):
    """Inner data object for token refresh."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    tokens: TokensOut


class UserResponse(BaseModel):
    """Response wrapper for GET /auth/me."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    data: UserData
    message: Optional[str] = None


class UserData(BaseModel):
    """Inner data object for user profile."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        populate_by_name=True,
    )

    user: UserOut


class MessageResponse(BaseModel):
    """Generic response with no data, just a message."""

    data: None = None
    message: str
