-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 003 — Service Taxonomy
-- ============================================================================
-- Closed task catalog: NO free-text task descriptions allowed.
-- Categories group tasks; each task has a required level and regulatory flags.
-- ============================================================================

BEGIN;

-- ---- Service categories ----
CREATE TABLE service_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            VARCHAR(100) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    icon_url        TEXT,
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    -- Parent for sub-categories (NULL = root)
    parent_id       UUID REFERENCES service_categories(id) ON DELETE SET NULL,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_service_categories_slug UNIQUE (slug)
);

-- ---- Service tasks (the actual closed catalog entries) ----
CREATE TABLE service_tasks (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id             UUID NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    slug                    VARCHAR(150) NOT NULL,
    name                    VARCHAR(300) NOT NULL,
    description             TEXT,
    -- Level required — business rule: must match provider_levels.level
    level                   provider_level NOT NULL,
    -- Regulatory / safety flags
    regulated               BOOLEAN NOT NULL DEFAULT FALSE,
    license_required        BOOLEAN NOT NULL DEFAULT FALSE,
    hazardous               BOOLEAN NOT NULL DEFAULT FALSE,
    structural              BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_eligible      BOOLEAN NOT NULL DEFAULT FALSE,
    -- Pricing guidance
    base_price_min_cents    INTEGER,
    base_price_max_cents    INTEGER,
    estimated_duration_min  INTEGER,  -- minutes
    -- Auto-escalation keywords (JSON array of strings)
    escalation_keywords     JSONB DEFAULT '[]'::JSONB,
    -- Display
    icon_url                TEXT,
    display_order           INTEGER NOT NULL DEFAULT 0,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_service_tasks_slug UNIQUE (slug),
    CONSTRAINT chk_price_range CHECK (
        base_price_min_cents IS NULL
        OR base_price_max_cents IS NULL
        OR base_price_min_cents <= base_price_max_cents
    ),
    CONSTRAINT chk_estimated_duration CHECK (
        estimated_duration_min IS NULL OR estimated_duration_min > 0
    )
);

-- ---- Provider task qualifications (which tasks a provider is qualified for) ----
CREATE TABLE provider_task_qualifications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id     UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES service_tasks(id) ON DELETE CASCADE,
    qualified       BOOLEAN NOT NULL DEFAULT FALSE,
    qualified_at    TIMESTAMP WITH TIME ZONE,
    -- Qualification can be auto-granted or manually approved
    auto_granted    BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by     UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_provider_task UNIQUE (provider_id, task_id)
);

-- ---- Indexes ----
CREATE INDEX idx_service_categories_parent ON service_categories (parent_id);
CREATE INDEX idx_service_categories_active ON service_categories (is_active, display_order);
CREATE INDEX idx_service_tasks_category ON service_tasks (category_id);
CREATE INDEX idx_service_tasks_level ON service_tasks (level);
CREATE INDEX idx_service_tasks_emergency ON service_tasks (id) WHERE emergency_eligible = TRUE;
CREATE INDEX idx_service_tasks_active ON service_tasks (is_active, display_order);
CREATE INDEX idx_service_tasks_regulated ON service_tasks (id) WHERE regulated = TRUE;
CREATE INDEX idx_provider_task_qual_provider ON provider_task_qualifications (provider_id);
CREATE INDEX idx_provider_task_qual_task ON provider_task_qualifications (task_id);
CREATE INDEX idx_provider_task_qual_qualified ON provider_task_qualifications (provider_id, task_id)
    WHERE qualified = TRUE;

-- ---- Triggers ----
CREATE TRIGGER trg_service_categories_updated_at
    BEFORE UPDATE ON service_categories
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_service_tasks_updated_at
    BEFORE UPDATE ON service_tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_provider_task_qualifications_updated_at
    BEFORE UPDATE ON provider_task_qualifications
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
