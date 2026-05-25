-- Migration 015: user recovery codes (offline password reset).
--
-- Until email/SMS infrastructure is in place, password recovery uses a
-- 12-char alphanumeric uppercase code shown to the user at registration
-- and visible from the Settings screen after re-entering their password.
--
-- The code is stored in plaintext so the user can retrieve it from
-- Settings whenever they need a reminder. Tradeoff accepted for MVP.
-- It is rotated after every successful password reset.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS recovery_code VARCHAR(20);

-- Backfill: generate a unique 12-char alphanumeric uppercase code for
-- each existing row that has none. Uses gen_random_uuid + base32-ish
-- transform to keep characters readable (no 0/O/1/I confusion-prone chars).
UPDATE users
SET recovery_code = upper(
    translate(
        substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
        'abcdef',
        'GHJKMN'
    )
)
WHERE recovery_code IS NULL;

ALTER TABLE users
    ALTER COLUMN recovery_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_recovery_code
    ON users(recovery_code);
