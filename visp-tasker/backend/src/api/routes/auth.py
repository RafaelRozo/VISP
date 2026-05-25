"""
Authentication API routes -- VISP-FE-AUTH-001
==============================================

Endpoints for user registration, login, token refresh, profile retrieval,
logout, and password reset initiation.

Routes:
  POST /api/v1/auth/register         -- create a new account
  POST /api/v1/auth/login            -- authenticate with email & password
  POST /api/v1/auth/refresh          -- exchange a refresh token for new tokens
  GET  /api/v1/auth/me               -- get the currently authenticated user
  POST /api/v1/auth/logout           -- log out (client-side token discard)
  POST /api/v1/auth/forgot-password  -- request a password reset email
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.auth import (
    AuthData,
    AuthResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    RefreshRequest,
    RegisterRequest,
    TokenRefreshData,
    TokenRefreshResponse,
    TokensOut,
    UserData,
    UserOut,
    UserResponse,
)
from src.services import auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_to_out(user, role_str: str) -> UserOut:
    """Convert a User ORM object to a UserOut schema with the role string."""
    from src.api.schemas.auth import UserDefaultAddressOut
    
    address = None
    if user.default_address_street:
        address = UserDefaultAddressOut(
            street=user.default_address_street,
            city=user.default_address_city or "",
            province=user.default_address_province or "",
            postal_code=user.default_address_postal_code or "",
            country=user.default_address_country or "CA",
            latitude=float(user.default_address_latitude) if user.default_address_latitude else None,
            longitude=float(user.default_address_longitude) if user.default_address_longitude else None,
            formatted_address=user.default_address_formatted
        )

    return UserOut(
        id=user.id,
        email=user.email,
        phone=user.phone,
        first_name=user.first_name,
        last_name=user.last_name,
        role=role_str,
        avatar_url=user.avatar_url,
        default_address=address,
        stripe_customer_id=user.stripe_customer_id,
        is_verified=user.email_verified,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _tokens_to_out(tokens: dict) -> TokensOut:
    """Convert a tokens dictionary to a TokensOut schema."""
    return TokensOut(
        access_token=tokens["access_token"],
        refresh_token=tokens["refresh_token"],
        expires_at=tokens["expires_at"],
    )


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------

@router.post(
    "/register",
    response_model=AuthResponse,
    response_model_by_alias=True,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
    description=(
        "Creates a new user account with the provided credentials and profile "
        "information. Returns the created user object and JWT tokens."
    ),
)
async def register(
    body: RegisterRequest,
    db: DBSession,
) -> AuthResponse:
    try:
        user, tokens = await auth_service.register(
            db=db,
            email=body.email,
            password=body.password,
            first_name=body.first_name,
            last_name=body.last_name,
            role=body.role,
            phone=body.phone,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    role_str = auth_service._get_role_string(user)

    return AuthResponse(
        data=AuthData(
            user=_user_to_out(user, role_str),
            tokens=_tokens_to_out(tokens),
            recovery_code=user.recovery_code,
        ),
        message="Account created successfully.",
    )


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------

@router.post(
    "/login",
    response_model=AuthResponse,
    response_model_by_alias=True,
    summary="Authenticate with email and password",
    description=(
        "Validates the provided credentials and returns the user object "
        "along with JWT access and refresh tokens."
    ),
)
async def login(
    body: LoginRequest,
    db: DBSession,
) -> AuthResponse:
    try:
        user, tokens = await auth_service.login(
            db=db,
            email=body.email,
            password=body.password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        )

    role_str = auth_service._get_role_string(user)

    return AuthResponse(
        data=AuthData(
            user=_user_to_out(user, role_str),
            tokens=_tokens_to_out(tokens),
        ),
        message="Logged in successfully.",
    )


# ---------------------------------------------------------------------------
# POST /auth/refresh
# ---------------------------------------------------------------------------

@router.post(
    "/refresh",
    response_model=TokenRefreshResponse,
    response_model_by_alias=True,
    summary="Refresh access token",
    description=(
        "Exchange a valid refresh token for a new pair of access and "
        "refresh tokens. The old refresh token is invalidated."
    ),
)
async def refresh(
    body: RefreshRequest,
    db: DBSession,
) -> TokenRefreshResponse:
    try:
        tokens = await auth_service.refresh_token(
            db=db,
            refresh_token_str=body.refresh_token,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        )

    return TokenRefreshResponse(
        data=TokenRefreshData(
            tokens=_tokens_to_out(tokens),
        ),
        message="Tokens refreshed successfully.",
    )


# ---------------------------------------------------------------------------
# GET /auth/me
# ---------------------------------------------------------------------------

@router.get(
    "/me",
    response_model=UserResponse,
    response_model_by_alias=True,
    summary="Get current user profile",
    description=(
        "Returns the profile of the currently authenticated user. "
        "Requires a valid Bearer token in the Authorization header."
    ),
)
async def me(
    current_user: CurrentUser,
) -> UserResponse:
    role_str = auth_service._get_role_string(current_user)

    return UserResponse(
        data=UserData(
            user=_user_to_out(current_user, role_str),
        ),
    )


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------

@router.post(
    "/logout",
    response_model=MessageResponse,
    response_model_by_alias=True,
    summary="Log out the current user",
    description=(
        "Logs out the current user. In a stateless JWT architecture the "
        "client is responsible for discarding the tokens. This endpoint "
        "serves as a semantic confirmation."
    ),
)
async def logout(
    current_user: CurrentUser,
) -> MessageResponse:
    # In a stateless JWT setup, logout is handled client-side by discarding
    # tokens. A production system could add the token JTI to a Redis
    # blacklist here for immediate invalidation.
    return MessageResponse(
        message="Logged out successfully.",
    )


# ---------------------------------------------------------------------------
# POST /auth/forgot-password
# ---------------------------------------------------------------------------

@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    response_model_by_alias=True,
    summary="Request a password reset email",
    description=(
        "Initiates a password reset flow by sending a reset link to the "
        "provided email address. Always returns a success response to "
        "prevent email enumeration."
    ),
)
async def forgot_password(
    body: ForgotPasswordRequest,
    db: DBSession,
) -> MessageResponse:
    # Look up the user (but do not reveal whether they exist)
    _user = await auth_service.get_user_by_email(db, body.email)

    # In production, this would enqueue a background job to send the
    # password reset email via the notification service. For now we
    # log and return success regardless.
    # TODO: Integrate with notification service to send actual reset email

    return MessageResponse(
        message="If an account exists with this email, a password reset link has been sent.",
    )


# ---------------------------------------------------------------------------
# POST /auth/recover-password (offline reset using recovery code)
# ---------------------------------------------------------------------------

from pydantic import BaseModel, ConfigDict, EmailStr, Field


def _camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


class RecoverPasswordRequest(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)
    email: EmailStr
    recovery_code: str = Field(min_length=8, max_length=20)
    new_password: str = Field(min_length=8, max_length=72)


class RecoverPasswordResponseData(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)
    recovery_code: str


class RecoverPasswordResponse(BaseModel):
    model_config = ConfigDict(alias_generator=_camel, populate_by_name=True)
    data: RecoverPasswordResponseData


@router.post(
    "/recover-password",
    response_model=RecoverPasswordResponse,
    response_model_by_alias=True,
    summary="Reset password using recovery code",
    description=(
        "Resets the user's password using their offline recovery code. "
        "Generates and returns a new recovery code (old one is invalidated)."
    ),
)
async def recover_password(
    body: RecoverPasswordRequest,
    db: DBSession,
) -> RecoverPasswordResponse:
    try:
        _user, new_code = await auth_service.reset_password_with_code(
            db,
            email=body.email,
            recovery_code=body.recovery_code,
            new_password=body.new_password,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc

    return RecoverPasswordResponse(
        data=RecoverPasswordResponseData(recovery_code=new_code),
    )
