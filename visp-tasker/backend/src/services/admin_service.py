"""
Admin / superuser auth service.

Issues and validates JWTs signed with a *separate* secret from regular
users (ADMIN_JWT_SECRET) so a leaked user token cannot be used against
admin endpoints and vice-versa.
"""

from __future__ import annotations

import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.models.admin_access_code import AdminAccessCode
from src.models.superuser import SuperUser


ACCESS_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0,O,1,I,L
ACCESS_CODE_LEN = 10
ACCESS_CODE_TTL_HOURS = 72


def generate_access_code() -> str:
    return "".join(secrets.choice(ACCESS_CODE_ALPHABET) for _ in range(ACCESS_CODE_LEN))


# ---------------------------------------------------------------------------
# Password helpers (separate from user passwords -- same bcrypt strength)
# ---------------------------------------------------------------------------

_PASSWORD_MIN_LEN = 8


def validate_admin_password(password: str) -> None:
    """Enforce admin password policy. Raises ValueError if it fails."""
    if len(password) < _PASSWORD_MIN_LEN:
        raise ValueError(
            f"Password must be at least {_PASSWORD_MIN_LEN} characters long."
        )
    if not any(c.isupper() for c in password):
        raise ValueError("Password must include at least one uppercase letter.")
    if not any(c.islower() for c in password):
        raise ValueError("Password must include at least one lowercase letter.")
    if not any(c.isdigit() for c in password):
        raise ValueError("Password must include at least one number.")
    if all(c.isalnum() for c in password):
        raise ValueError("Password must include at least one special character.")


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Token creation / decoding (separate secret from user tokens)
# ---------------------------------------------------------------------------

def create_admin_tokens(superuser_id: uuid.UUID) -> dict:
    now = datetime.now(timezone.utc)
    access_exp = now + timedelta(minutes=settings.admin_access_token_minutes)
    refresh_exp = now + timedelta(days=settings.admin_refresh_token_days)

    access_payload = {
        "sub": str(superuser_id),
        "type": "admin_access",
        "iat": int(now.timestamp()),
        "exp": int(access_exp.timestamp()),
    }
    refresh_payload = {
        "sub": str(superuser_id),
        "type": "admin_refresh",
        "iat": int(now.timestamp()),
        "exp": int(refresh_exp.timestamp()),
    }
    access = jwt.encode(access_payload, settings.admin_jwt_secret, algorithm=settings.jwt_algorithm)
    refresh = jwt.encode(refresh_payload, settings.admin_jwt_secret, algorithm=settings.jwt_algorithm)
    return {
        "accessToken": access,
        "refreshToken": refresh,
        "expiresAt": int(access_exp.timestamp() * 1000),
    }


def decode_admin_token(token: str, expected_type: str = "admin_access") -> uuid.UUID:
    try:
        payload = jwt.decode(token, settings.admin_jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("Token has expired.") from exc
    except jwt.PyJWTError as exc:
        raise ValueError("Invalid token.") from exc

    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type.")

    sub = payload.get("sub")
    if not sub:
        raise ValueError("Invalid token: missing subject.")
    try:
        return uuid.UUID(sub)
    except ValueError as exc:
        raise ValueError("Invalid token subject.") from exc


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------

async def get_superuser_by_email(db: AsyncSession, email: str) -> Optional[SuperUser]:
    stmt = select(SuperUser).where(SuperUser.email == email.lower().strip())
    return (await db.execute(stmt)).scalars().first()


async def get_superuser_by_id(db: AsyncSession, superuser_id: uuid.UUID) -> Optional[SuperUser]:
    stmt = select(SuperUser).where(SuperUser.id == superuser_id)
    return (await db.execute(stmt)).scalars().first()


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

async def login(db: AsyncSession, email: str, password: str) -> tuple[SuperUser, dict]:
    """Authenticate a superuser by email + password.

    Raises ValueError on bad credentials or inactive account.
    """
    user = await get_superuser_by_email(db, email)
    if user is None or not verify_password(password, user.password_hash):
        # Generic message to avoid email enumeration
        raise ValueError("Invalid email or password.")
    if not user.is_active:
        raise ValueError("This account has been disabled.")

    user.last_login_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)

    tokens = create_admin_tokens(user.id)
    return user, tokens


async def refresh_admin_tokens(db: AsyncSession, refresh_token: str) -> tuple[SuperUser, dict]:
    superuser_id = decode_admin_token(refresh_token, expected_type="admin_refresh")
    user = await get_superuser_by_id(db, superuser_id)
    if user is None or not user.is_active:
        raise ValueError("Account not found or disabled.")
    return user, create_admin_tokens(user.id)


async def get_current_admin(db: AsyncSession, access_token: str) -> SuperUser:
    superuser_id = decode_admin_token(access_token, expected_type="admin_access")
    user = await get_superuser_by_id(db, superuser_id)
    if user is None or not user.is_active:
        raise ValueError("Account not found or disabled.")
    return user


# ---------------------------------------------------------------------------
# Invite + reset code flows
# ---------------------------------------------------------------------------

async def create_invite_code(
    db: AsyncSession,
    *,
    inviter: SuperUser,
    email: str,
    role: str,
    first_name: str,
    last_name: str,
) -> tuple[str, AdminAccessCode]:
    email = email.lower().strip()
    if await get_superuser_by_email(db, email) is not None:
        raise ValueError("A superuser with that email already exists.")

    plaintext = generate_access_code()
    row = AdminAccessCode(
        email=email,
        code_hash=hash_password(plaintext),
        purpose="invite",
        superuser_id=None,
        invited_role=role,
        invited_first_name=first_name,
        invited_last_name=last_name,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ACCESS_CODE_TTL_HOURS),
        created_by=inviter.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return plaintext, row


async def create_reset_code(
    db: AsyncSession,
    *,
    inviter: SuperUser,
    superuser_id: uuid.UUID,
) -> tuple[str, AdminAccessCode]:
    user = await get_superuser_by_id(db, superuser_id)
    if user is None:
        raise ValueError("Superuser not found.")

    plaintext = generate_access_code()
    row = AdminAccessCode(
        email=user.email,
        code_hash=hash_password(plaintext),
        purpose="reset",
        superuser_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=ACCESS_CODE_TTL_HOURS),
        created_by=inviter.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return plaintext, row


async def _find_active_code(
    db: AsyncSession, *, email: str, purpose: str
) -> Optional[AdminAccessCode]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(AdminAccessCode)
        .where(AdminAccessCode.email == email.lower().strip())
        .where(AdminAccessCode.purpose == purpose)
        .where(AdminAccessCode.used_at.is_(None))
        .where(AdminAccessCode.expires_at > now)
        .order_by(AdminAccessCode.created_at.desc())
    )
    return (await db.execute(stmt)).scalars().first()


async def redeem_invite(
    db: AsyncSession,
    *,
    email: str,
    code: str,
    password: str,
) -> SuperUser:
    validate_admin_password(password)
    row = await _find_active_code(db, email=email, purpose="invite")
    if row is None or not verify_password(code, row.code_hash):
        raise ValueError("Invalid or expired code.")

    su = SuperUser(
        email=row.email,
        password_hash=hash_password(password),
        first_name=row.invited_first_name or "Admin",
        last_name=row.invited_last_name or "User",
        role=row.invited_role or "admin",
        is_active=True,
    )
    db.add(su)
    row.used_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(su)
    return su


async def redeem_reset(
    db: AsyncSession,
    *,
    email: str,
    code: str,
    password: str,
) -> SuperUser:
    validate_admin_password(password)
    row = await _find_active_code(db, email=email, purpose="reset")
    if row is None or not verify_password(code, row.code_hash):
        raise ValueError("Invalid or expired code.")
    if row.superuser_id is None:
        raise ValueError("Invalid reset code.")
    user = await get_superuser_by_id(db, row.superuser_id)
    if user is None:
        raise ValueError("Superuser not found.")

    user.password_hash = hash_password(password)
    user.is_active = True
    row.used_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(user)
    return user
