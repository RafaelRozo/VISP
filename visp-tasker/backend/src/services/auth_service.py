"""
Authentication service for the VISP/Tasker platform.

Handles user registration, login, JWT token management, and password
reset flows. Uses bcrypt for password hashing and PyJWT for token
generation/verification.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.user import AuthProvider, User, UserStatus

# ---------------------------------------------------------------------------
# Password hashing (bcrypt 5.x direct usage — passlib is incompatible)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    # bcrypt requires bytes; truncate to 72 bytes (bcrypt limit)
    pw_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a bcrypt hash."""
    pw_bytes = plain_password.encode("utf-8")[:72]
    hashed_bytes = hashed_password.encode("utf-8")
    return bcrypt.checkpw(pw_bytes, hashed_bytes)


# ---------------------------------------------------------------------------
# JWT token generation
# ---------------------------------------------------------------------------

ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7


def create_access_token(user_id: uuid.UUID) -> tuple[str, datetime]:
    """Create a short-lived access token.

    Returns:
        Tuple of (token_string, expiration_datetime).
    """
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user_id),
        "type": "access",
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_refresh_token(user_id: uuid.UUID) -> tuple[str, datetime]:
    """Create a long-lived refresh token.

    Returns:
        Tuple of (token_string, expiration_datetime).
    """
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": expires_at,
        "iat": datetime.now(timezone.utc),
        "jti": str(uuid.uuid4()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_at


def create_tokens(user_id: uuid.UUID) -> dict:
    """Create both access and refresh tokens for a user.

    Returns:
        Dictionary with accessToken, refreshToken, and expiresAt.
    """
    access_token, access_expires = create_access_token(user_id)
    refresh_token, _ = create_refresh_token(user_id)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": access_expires,
    }


def decode_token(token: str) -> dict:
    """Decode and verify a JWT token.

    Raises:
        jwt.ExpiredSignatureError: If the token has expired.
        jwt.InvalidTokenError: If the token is otherwise invalid.
    """
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )


# ---------------------------------------------------------------------------
# User role helpers
# ---------------------------------------------------------------------------

def _parse_role(role: str) -> tuple[bool, bool]:
    """Convert a role string to (role_customer, role_provider) booleans.

    Valid values: 'customer', 'provider', 'both'.
    """
    role_lower = role.lower().strip()
    if role_lower == "customer":
        return True, False
    elif role_lower == "provider":
        return False, True
    elif role_lower == "both":
        return True, True
    else:
        raise ValueError(f"Invalid role: {role}. Must be 'customer', 'provider', or 'both'.")


def _get_role_string(user: User) -> str:
    """Convert user role booleans back to a role string for API responses."""
    if user.role_customer and user.role_provider:
        return "both"
    elif user.role_provider:
        return "provider"
    else:
        return "customer"


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------

async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """Look up a user by email address."""
    stmt = select(User).where(User.email == email.lower().strip())
    result = await db.execute(stmt)
    return result.scalars().first()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
    """Look up a user by primary key."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    return result.scalars().first()


async def register(
    db: AsyncSession,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    role: str,
    phone: Optional[str] = None,
) -> tuple[User, dict]:
    """Register a new user.

    Args:
        db: Async database session.
        email: User email address.
        password: Plaintext password (will be hashed).
        first_name: User first name.
        last_name: User last name.
        role: One of 'customer', 'provider', 'both'.
        phone: Optional phone number.

    Returns:
        Tuple of (user_object, tokens_dict).

    Raises:
        ValueError: If email is already registered or role is invalid.
    """
    # Normalize email
    email = email.lower().strip()

    # Check for existing user
    existing = await get_user_by_email(db, email)
    if existing is not None:
        raise ValueError("A user with this email address already exists.")

    # Parse role
    role_customer, role_provider = _parse_role(role)

    # Create user
    user = User(
        email=email,
        password_hash=hash_password(password),
        first_name=first_name,
        last_name=last_name,
        phone=phone,
        auth_provider=AuthProvider.EMAIL,
        role_customer=role_customer,
        role_provider=role_provider,
        role_admin=False,
        status=UserStatus.PENDING_VERIFICATION,
        email_verified=False,
        phone_verified=False,
    )

    db.add(user)
    await db.flush()  # Flush to generate ID without committing

    # Generate tokens
    tokens = create_tokens(user.id)

    return user, tokens


async def login(
    db: AsyncSession,
    email: str,
    password: str,
) -> tuple[User, dict]:
    """Authenticate a user with email and password.

    Args:
        db: Async database session.
        email: User email address.
        password: Plaintext password.

    Returns:
        Tuple of (user_object, tokens_dict).

    Raises:
        ValueError: If credentials are invalid or account is not active.
    """
    email = email.lower().strip()

    user = await get_user_by_email(db, email)
    if user is None:
        raise ValueError("Invalid email or password.")

    if user.password_hash is None:
        raise ValueError("Invalid email or password.")

    if not verify_password(password, user.password_hash):
        raise ValueError("Invalid email or password.")

    # Check account status
    if user.status == UserStatus.BANNED:
        raise ValueError("This account has been banned.")
    if user.status == UserStatus.SUSPENDED:
        raise ValueError("This account is currently suspended.")
    if user.status == UserStatus.DEACTIVATED:
        raise ValueError("This account has been deactivated.")

    # Update last login timestamp
    user.last_login_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(user)

    # Generate tokens
    tokens = create_tokens(user.id)

    return user, tokens


async def refresh_token(
    db: AsyncSession,
    refresh_token_str: str,
) -> dict:
    """Validate a refresh token and issue new tokens.

    Args:
        db: Async database session.
        refresh_token_str: The refresh token string to validate.

    Returns:
        Dictionary with new tokens.

    Raises:
        ValueError: If the refresh token is invalid or expired.
    """
    try:
        payload = decode_token(refresh_token_str)
    except jwt.ExpiredSignatureError:
        raise ValueError("Refresh token has expired. Please log in again.")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid refresh token.")

    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type. Expected a refresh token.")

    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise ValueError("Invalid refresh token: missing subject.")

    try:
        user_id = uuid.UUID(user_id_str)
    except (ValueError, AttributeError):
        raise ValueError("Invalid refresh token: malformed subject.")

    # Verify user still exists and is active
    user = await get_user_by_id(db, user_id)
    if user is None:
        raise ValueError("User not found.")
    if user.status in (UserStatus.BANNED, UserStatus.SUSPENDED, UserStatus.DEACTIVATED):
        raise ValueError("Account is no longer active.")

    # Issue new tokens
    return create_tokens(user.id)


async def get_current_user(
    db: AsyncSession,
    token: str,
) -> User:
    """Decode a JWT access token and return the corresponding user.

    Args:
        db: Async database session.
        token: JWT access token string.

    Returns:
        The authenticated User object.

    Raises:
        ValueError: If the token is invalid, expired, or user not found.
    """
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise ValueError("Access token has expired.")
    except jwt.InvalidTokenError:
        raise ValueError("Invalid access token.")

    if payload.get("type") != "access":
        raise ValueError("Invalid token type. Expected an access token.")

    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise ValueError("Invalid token: missing subject.")

    try:
        user_id = uuid.UUID(user_id_str)
    except (ValueError, AttributeError):
        raise ValueError("Invalid token: malformed subject.")

    user = await get_user_by_id(db, user_id)
    if user is None:
        raise ValueError("User not found.")
    if user.status in (UserStatus.BANNED, UserStatus.SUSPENDED, UserStatus.DEACTIVATED):
        raise ValueError("Account is no longer active.")

    return user
