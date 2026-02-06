-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 001 — Users
-- ============================================================================
-- Creates the foundational users table for both customers and providers.
-- A single user row can hold both roles (role_customer, role_provider).
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE user_status AS ENUM (
    'PENDING_VERIFICATION',
    'ACTIVE',
    'SUSPENDED',
    'DEACTIVATED',
    'BANNED'
);

CREATE TYPE auth_provider AS ENUM (
    'EMAIL',
    'APPLE',
    'GOOGLE',
    'PHONE'
);

-- ---- Users table ----
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Authentication
    email           VARCHAR(320) NOT NULL,
    phone           VARCHAR(20),
    password_hash   VARCHAR(255),
    auth_provider   auth_provider NOT NULL DEFAULT 'EMAIL',
    auth_provider_id VARCHAR(255),
    -- Profile
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100) NOT NULL,
    display_name    VARCHAR(200),
    avatar_url      TEXT,
    -- Roles — a user can be both customer and provider
    role_customer   BOOLEAN NOT NULL DEFAULT FALSE,
    role_provider   BOOLEAN NOT NULL DEFAULT FALSE,
    role_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Status
    status          user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    -- Location (last known)
    last_latitude   NUMERIC(10, 7),
    last_longitude  NUMERIC(10, 7),
    timezone        VARCHAR(50) DEFAULT 'America/Toronto',
    locale          VARCHAR(10) DEFAULT 'en',
    -- Metadata
    last_login_at   TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMP WITH TIME ZONE,

    -- Constraints
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT uq_users_phone UNIQUE (phone),
    CONSTRAINT chk_users_has_role CHECK (
        role_customer OR role_provider OR role_admin
    )
);

-- ---- Indexes ----
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_phone ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_role_provider ON users (id) WHERE role_provider = TRUE;
CREATE INDEX idx_users_role_customer ON users (id) WHERE role_customer = TRUE;
CREATE INDEX idx_users_location ON users (last_latitude, last_longitude)
    WHERE last_latitude IS NOT NULL AND last_longitude IS NOT NULL;

-- ---- Trigger: updated_at auto-set ----
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
