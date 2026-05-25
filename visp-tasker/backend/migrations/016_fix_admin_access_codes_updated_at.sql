-- Migration 016: backfill missing `updated_at` column on admin_access_codes.
--
-- Migration 014 created the table without `updated_at`, but the SQLAlchemy
-- model uses `TimestampMixin` (created_at + updated_at). INSERTs from the
-- /admin/superusers/invite endpoint failed with a 500 on production until
-- this column existed.

ALTER TABLE admin_access_codes
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
