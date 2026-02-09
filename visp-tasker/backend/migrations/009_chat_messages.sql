-- Migration 009: Create chat_messages table
-- VISP-INT-REALTIME-004 -- In-app chat between customer and provider
--
-- Chat messages are scoped to an active job. Both parties can exchange
-- messages from the time a provider is matched through job completion.
-- All messages are persisted for audit and dispute resolution.
--
-- Business rule: No free-text task modification is allowed through chat.
-- The provider cannot decide scope -- additional services require a new job.

-- Message type enum
DO $$ BEGIN
    CREATE TYPE message_type AS ENUM ('text', 'image', 'system');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    message_text    TEXT NOT NULL,
    message_type    message_type NOT NULL DEFAULT 'text',
    read_by_recipient BOOLEAN NOT NULL DEFAULT FALSE,
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fetching chat history for a job (ordered by time)
CREATE INDEX IF NOT EXISTS idx_chat_messages_job_id
    ON chat_messages(job_id);

-- Composite index for paginated history queries with cursor-based pagination
CREATE INDEX IF NOT EXISTS idx_chat_messages_job_created
    ON chat_messages(job_id, created_at DESC);

-- Index for sender lookups (e.g., unread count per user)
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id
    ON chat_messages(sender_id);

-- Partial index for efficiently counting unread messages per job
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
    ON chat_messages(job_id, sender_id)
    WHERE read_by_recipient = FALSE;

-- Trigger to auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_chat_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chat_messages_updated_at ON chat_messages;
CREATE TRIGGER trg_chat_messages_updated_at
    BEFORE UPDATE ON chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_messages_updated_at();
