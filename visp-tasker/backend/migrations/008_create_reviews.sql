-- ============================================================================
-- VISP-DB-SCHEMA-001 :: Migration 008 — Reviews
-- ============================================================================
-- Reviews with weighted scoring dimensions. Each review can have
-- multiple dimension scores that feed into the provider's internal_score.
-- ============================================================================

BEGIN;

-- ---- ENUM types ----
CREATE TYPE review_status AS ENUM (
    'PENDING',
    'PUBLISHED',
    'HIDDEN',
    'FLAGGED',
    'REMOVED'
);

CREATE TYPE reviewer_role AS ENUM (
    'CUSTOMER',
    'PROVIDER'
);

-- ---- Reviews ----
CREATE TABLE reviews (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id                  UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
    -- Who is reviewing whom
    reviewer_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewee_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewer_role           reviewer_role NOT NULL,
    -- Overall rating (1-5, stored as numeric for weighted averaging)
    overall_rating          NUMERIC(3, 2) NOT NULL,
    -- Weighted composite score (calculated from dimensions)
    weighted_score          NUMERIC(5, 2),
    -- Free text (moderated)
    comment                 TEXT,
    -- Status
    status                  review_status NOT NULL DEFAULT 'PENDING',
    moderated_at            TIMESTAMP WITH TIME ZONE,
    moderated_by            UUID REFERENCES users(id),
    moderation_notes        TEXT,
    -- Provider response
    response_text           TEXT,
    response_at             TIMESTAMP WITH TIME ZONE,
    -- Metadata
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    -- A user can only review once per job per role
    CONSTRAINT uq_review_per_job UNIQUE (job_id, reviewer_id, reviewer_role),
    CONSTRAINT chk_overall_rating CHECK (overall_rating >= 1.00 AND overall_rating <= 5.00),
    CONSTRAINT chk_weighted_score CHECK (weighted_score IS NULL OR (weighted_score >= 0 AND weighted_score <= 100)),
    CONSTRAINT chk_different_users CHECK (reviewer_id != reviewee_id)
);

-- ---- Review scoring dimensions ----
CREATE TABLE review_dimensions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    slug            VARCHAR(100) NOT NULL,
    description     TEXT,
    -- Weight for composite scoring (all weights should sum to 1.0 per role)
    weight          NUMERIC(4, 3) NOT NULL,
    -- Which reviewer role uses this dimension
    applicable_role reviewer_role NOT NULL,
    -- Display
    display_order   INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_review_dimension_slug UNIQUE (slug),
    CONSTRAINT chk_weight CHECK (weight > 0 AND weight <= 1)
);

-- ---- Review dimension scores (individual dimension ratings per review) ----
CREATE TABLE review_dimension_scores (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id       UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    dimension_id    UUID NOT NULL REFERENCES review_dimensions(id) ON DELETE RESTRICT,
    score           NUMERIC(3, 2) NOT NULL,  -- 1.00 - 5.00
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_review_dimension UNIQUE (review_id, dimension_id),
    CONSTRAINT chk_dimension_score CHECK (score >= 1.00 AND score <= 5.00)
);

-- ---- Indexes ----
CREATE INDEX idx_reviews_job ON reviews (job_id);
CREATE INDEX idx_reviews_reviewer ON reviews (reviewer_id);
CREATE INDEX idx_reviews_reviewee ON reviews (reviewee_id);
CREATE INDEX idx_reviews_status ON reviews (status);
CREATE INDEX idx_reviews_reviewee_rating ON reviews (reviewee_id, overall_rating DESC)
    WHERE status = 'PUBLISHED';
CREATE INDEX idx_reviews_created ON reviews (created_at DESC);

CREATE INDEX idx_review_dim_scores_review ON review_dimension_scores (review_id);
CREATE INDEX idx_review_dim_scores_dimension ON review_dimension_scores (dimension_id);

-- ---- Triggers ----
CREATE TRIGGER trg_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_review_dimensions_updated_at
    BEFORE UPDATE ON review_dimensions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

COMMIT;
