-- Migration 012: superusers table for admin dashboard access
-- Separate from `users` so a compromise of the user table cannot escalate
-- privileges to admin. Uses a different JWT secret in code (ADMIN_JWT_SECRET).

CREATE TABLE IF NOT EXISTS superusers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'admin',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_superusers_email ON superusers(email);
CREATE INDEX IF NOT EXISTS idx_superusers_active ON superusers(is_active);

-- The seed admin user is inserted by `scripts/seed_superuser.py` so the
-- bcrypt hash is generated correctly without leaking the plaintext into
-- migrations stored in git.
