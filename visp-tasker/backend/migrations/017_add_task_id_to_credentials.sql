-- Migration 017: link provider credentials to the service_task they unlock.
--
-- Until now the upload endpoint accepted a `task_id` form field but only used
-- it to copy the task name into `provider_credentials.name`. The FK was never
-- persisted, so the admin dashboard could not tell which service a credential
-- was uploaded for (e.g. "license for Emergency flood water extraction" vs
-- "general trade license"). This migration adds the FK so the admin reviewer
-- can see the target service.
--
-- Nullable: general credentials (criminal record check, portfolio, generic
-- insurance) are not bound to a single task.

ALTER TABLE provider_credentials
    ADD COLUMN IF NOT EXISTS task_id UUID NULL
        REFERENCES service_tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_credentials_task_id
    ON provider_credentials(task_id);
