-- 032_level_model.sql
-- Reestructuración de niveles L0..L3 — PASO 2: modelo de datos.
--
-- El nivel deja de ser GLOBAL por proveedor y pasa a ser:
--   * por CLASIFICACIÓN (categoría) para L1  -> provider_classification_levels
--   * por SERVICIO individual para L2/L3     -> service_credential_requirements
--                                               + provider_credential_codes
--
-- No toca datos del catálogo (eso es la 033). Todo lo de aquí es aditivo.
-- Requiere la 031 aplicada (LEVEL_0 en el enum provider_level).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Catálogo de códigos de credencial (306A, 309A, ESA_LEC, TSSA_G2, ...)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE credential_verification_method AS ENUM ('REGISTRY', 'DOCUMENT', 'SELF_DECLARED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS credential_requirements (
    code                 VARCHAR(40)  PRIMARY KEY,
    label_en             VARCHAR(200) NOT NULL,
    label_fr             VARCHAR(200),
    authority            VARCHAR(200),
    registry_name        VARCHAR(200),
    registry_url         TEXT,
    verification_method  credential_verification_method NOT NULL DEFAULT 'DOCUMENT',
    description          TEXT,
    is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Qué códigos exige cada SERVICIO (la pieza que hace el gate por servicio)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_credential_requirements (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID        NOT NULL REFERENCES service_tasks(id) ON DELETE CASCADE,
    code        VARCHAR(40) NOT NULL REFERENCES credential_requirements(code),
    mandatory   BOOLEAN     NOT NULL DEFAULT TRUE,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_credential_requirement UNIQUE (task_id, code)
);
CREATE INDEX IF NOT EXISTS ix_scr_task ON service_credential_requirements (task_id);
CREATE INDEX IF NOT EXISTS ix_scr_code ON service_credential_requirements (code);

-- ---------------------------------------------------------------------------
-- 3. Nivel alcanzado POR CLASIFICACIÓN  ("L2: Plumbing")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_classification_levels (
    id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id   UUID           NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    category_id   UUID           NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    level         provider_level NOT NULL DEFAULT 'LEVEL_0',
    granted_at    TIMESTAMPTZ,
    -- EXPERIENCE | CREDENTIAL | BUSINESS | WAIVER
    source        VARCHAR(40),
    waiver_by     UUID           REFERENCES users(id),
    waiver_reason TEXT,
    created_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_classification UNIQUE (provider_id, category_id)
);
CREATE INDEX IF NOT EXISTS ix_pcl_provider ON provider_classification_levels (provider_id);

-- ---------------------------------------------------------------------------
-- 4. Evidencia de experiencia para L1.
--    VISP VALIDA LA DOCUMENTACIÓN, NO APRUEBA LA COMPETENCIA.
--    REJECTED = documentación incompleta o ilegible, nunca "no eres competente".
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE experience_record_kind AS ENUM (
        'PREVIOUS_JOBS', 'RESUME', 'RECOMMENDATION_LETTER', 'REFERENCE',
        'WORK_PHOTOS', 'TRAINING_RECORD', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE experience_record_status AS ENUM ('PENDING', 'VALIDATED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS provider_experience_records (
    id               UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id      UUID                     NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    category_id      UUID                     NOT NULL REFERENCES service_categories(id) ON DELETE CASCADE,
    kind             experience_record_kind   NOT NULL,
    title            VARCHAR(200),
    description      TEXT,
    document_url     TEXT,
    status           experience_record_status NOT NULL DEFAULT 'PENDING',
    submitted_at     TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    validated_at     TIMESTAMPTZ,
    validated_by     UUID                     REFERENCES users(id),
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_per_provider_cat ON provider_experience_records (provider_id, category_id);
CREATE INDEX IF NOT EXISTS ix_per_status       ON provider_experience_records (status);

-- ---------------------------------------------------------------------------
-- 5. Qué códigos acredita una credencial verificada del proveedor.
--    Motor: servicio_exige(codes) ⊆ codes_verificados_y_vigentes(proveedor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_credential_codes (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id UUID        NOT NULL REFERENCES provider_credentials(id) ON DELETE CASCADE,
    code          VARCHAR(40) NOT NULL REFERENCES credential_requirements(code),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_credential_code UNIQUE (credential_id, code)
);
CREATE INDEX IF NOT EXISTS ix_pcc_credential ON provider_credential_codes (credential_id);

-- ---------------------------------------------------------------------------
-- 6. Política por nivel. El gate de historial de L3 queda DESACTIVADO (0/0)
--    por decisión de negocio, pero las columnas existen para encenderlo luego
--    sin volver a migrar.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS level_policy (
    id                            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    level                         provider_level NOT NULL UNIQUE,
    requires_experience           BOOLEAN        NOT NULL DEFAULT FALSE,
    requires_credential           BOOLEAN        NOT NULL DEFAULT FALSE,
    requires_insurance            BOOLEAN        NOT NULL DEFAULT FALSE,
    requires_business             BOOLEAN        NOT NULL DEFAULT FALSE,
    min_completed_jobs_prev_level INTEGER        NOT NULL DEFAULT 0,
    min_avg_rating                NUMERIC(3,2)   NOT NULL DEFAULT 0,
    is_active                     BOOLEAN        NOT NULL DEFAULT TRUE,
    notes                         TEXT,
    created_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at                    TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

INSERT INTO level_policy (level, requires_experience, requires_credential, requires_insurance,
                          requires_business, min_completed_jobs_prev_level, min_avg_rating, is_active, notes)
VALUES
 ('LEVEL_0', FALSE, FALSE, FALSE, FALSE, 0, 0, TRUE,
  '18+, orientación de seguridad, licencia G1/G2/G como ID, ToS, acuerdo de seguridad por trabajo.'),
 ('LEVEL_1', TRUE,  FALSE, FALSE, FALSE, 0, 0, TRUE,
  'Evidencia de experiencia por categoría VALIDADA por VISP (validación documental, NO aprobación de competencia).'),
 ('LEVEL_2', TRUE,  TRUE,  TRUE,  FALSE, 0, 0, TRUE,
  'Credencial que coincide con el servicio exacto, verificada en el registro oficial, + CGL vigente.'),
 ('LEVEL_3', TRUE,  TRUE,  TRUE,  TRUE,  0, 0, TRUE,
  'Lo de L2 + cuenta de EMPRESA registrada con BIN/OCN de Ontario verificado. Gate de historial desactivado (0/0) por decisión de negocio 2026-08-04.'),
 ('LEVEL_4', FALSE, FALSE, FALSE, FALSE, 0, 0, FALSE,
  'MUERTO. L4/Emergency eliminado del producto 2026-08-04.')
ON CONFLICT (level) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Columnas nuevas sobre tablas existentes
-- ---------------------------------------------------------------------------

-- Credenciales: código acreditado + auditoría de verificación en registro oficial
-- + datos de aprendiz (empresa patrocinadora).
ALTER TABLE provider_credentials
    ADD COLUMN IF NOT EXISTS requirement_code     VARCHAR(40) REFERENCES credential_requirements(code),
    ADD COLUMN IF NOT EXISTS registry_name        VARCHAR(200),
    ADD COLUMN IF NOT EXISTS registry_reference   VARCHAR(200),
    ADD COLUMN IF NOT EXISTS registry_checked_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registry_checked_by  UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS suspended_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sponsor_company_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS sponsor_supervisor   VARCHAR(200),
    ADD COLUMN IF NOT EXISTS authorization_start  DATE,
    ADD COLUMN IF NOT EXISTS authorization_end    DATE;

-- Seguro CGL: el nombre asegurado y las operaciones cubiertas deben coincidir
-- con la cuenta del proveedor/empresa.
ALTER TABLE provider_insurance_policies
    ADD COLUMN IF NOT EXISTS insured_name             VARCHAR(200),
    ADD COLUMN IF NOT EXISTS covered_operations       TEXT,
    ADD COLUMN IF NOT EXISTS matches_account_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Empresa: registro de Ontario (el BN de CRA NO sustituye al BIN/OCN).
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS ontario_bin          VARCHAR(30),
    ADD COLUMN IF NOT EXISTS ontario_ocn          VARCHAR(30),
    ADD COLUMN IF NOT EXISTS registry_status      VARCHAR(20) NOT NULL DEFAULT 'UNVERIFIED',
    ADD COLUMN IF NOT EXISTS registry_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registry_verified_by UUID REFERENCES users(id);

-- 18+ estricto: los menores no pueden trabajar en VISP.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Requisitos de L0 sobre el perfil de proveedor.
ALTER TABLE provider_profiles
    ADD COLUMN IF NOT EXISTS safety_orientation_completed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS identity_license_credential_id  UUID REFERENCES provider_credentials(id),
    ADD COLUMN IF NOT EXISTS identity_license_class          license_class;

-- Servicios que exigen conducir (el PDF marca 'Local Apartment Move' como G2/G).
ALTER TABLE service_tasks
    ADD COLUMN IF NOT EXISTS requires_driver_license BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS min_age                 INTEGER;

-- ---------------------------------------------------------------------------
-- 8. Seed del catálogo de códigos de credencial (extraídos del PDF)
-- ---------------------------------------------------------------------------
INSERT INTO credential_requirements (code, label_en, label_fr, authority, registry_name, verification_method, description) VALUES
 ('306A',        'Plumber (306A)',                                  'Plombier (306A)',                                  'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', 'Certificate of Qualification — compulsory trade.'),
 ('307A',        'Steamfitter (307A)',                              'Tuyauteur-monteur (307A)',                         'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('308A',        'Sheet Metal Worker (308A)',                       'Ferblantier (308A)',                               'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('308R',        'Residential Low-Rise Sheet Metal Installer (308R)','Installateur de tôle résidentiel (308R)',          'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('309A',        'Electrician — Construction & Maintenance (309A)',  'Électricien — construction et entretien (309A)',   'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', 'Compulsory trade.'),
 ('309C',        'Electrician — Domestic & Rural (309C)',            'Électricien — domestique et rural (309C)',         'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('313A',        'Refrigeration & Air Conditioning Mechanic (313A)', 'Mécanicien en réfrigération et climatisation (313A)','Skilled Trades Ontario','Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('313D',        'Residential Air Conditioning Mechanic (313D)',     'Mécanicien en climatisation résidentielle (313D)', 'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('403A',        'General Carpenter (403A)',                         'Charpentier général (403A)',                       'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', 'Recomendado, no compulsory.'),
 ('444B',        'Utility Arborist (444B)',                          'Arboriculteur de services publics (444B)',         'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('449A',        'Roofer (449A)',                                    'Couvreur (449A)',                                  'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', 'Recomendado.'),
 ('259L',        'Locksmith (259L)',                                 'Serrurier (259L)',                                 'Skilled Trades Ontario', 'Skilled Trades Ontario Public Register', 'REGISTRY', NULL),
 ('ESA_LEC',     'ECRA/ESA Licensed Electrical Contractor',          'Entrepreneur électricien agréé ECRA/ESA',          'Electrical Safety Authority', 'ESA Contractor Licence Registry', 'REGISTRY', 'Todo trabajo eléctrico fijo debe hacerse a través de un LEC.'),
 ('TSSA_FUELS',  'TSSA-registered Fuels Contractor',                 'Entrepreneur en carburants inscrit TSSA',          'TSSA', 'TSSA Fuels Contractor Registry', 'REGISTRY', NULL),
 ('TSSA_G1',     'Gas Technician 1 (G1)',                            'Technicien gazier 1 (G1)',                         'TSSA', 'TSSA Certificate Registry', 'REGISTRY', NULL),
 ('TSSA_G2',     'Gas Technician 2 (G2)',                            'Technicien gazier 2 (G2)',                         'TSSA', 'TSSA Certificate Registry', 'REGISTRY', NULL),
 ('TSSA_EDM_E',  'Elevating Device Mechanic (EDM-E)',                'Mécanicien d''appareils élévateurs (EDM-E)',       'TSSA', 'TSSA Certificate Registry', 'REGISTRY', 'Para elevadores/plataformas/sillas salvaescaleras.'),
 ('ODP',         'Ozone Depletion Prevention (ODP) card',            'Carte de prévention de l''appauvrissement de l''ozone', 'Environment Canada', NULL, 'DOCUMENT', 'Manejo de refrigerantes.'),
 ('BCIN',        'BCIN-qualified Designer',                          'Concepteur qualifié BCIN',                         'Ontario Ministry of Municipal Affairs and Housing', 'Qualified & Registered Persons Public Registry', 'REGISTRY', NULL),
 ('P_ENG',       'Professional Engineer (P.Eng.)',                   'Ingénieur (ing.)',                                 'Professional Engineers Ontario', 'PEO Directory', 'REGISTRY', NULL),
 ('BUILDING_PERMIT','Building Permit',                               'Permis de construire',                             'Municipalidad', NULL, 'DOCUMENT', 'Permiso municipal por trabajo, no credencial del proveedor.'),
 ('WAH_CPO',     'CPO-Approved Working at Heights — Full Course',    'Travail en hauteur approuvé CPO — cours complet',  'Ontario Ministry of Labour (CPO)', NULL, 'DOCUMENT', NULL),
 ('WHMIS',       'WHMIS Training',                                   'Formation SIMDUT',                                 'Ontario Ministry of Labour', NULL, 'DOCUMENT', NULL),
 ('IICRC_AMRT',  'IICRC Applied Microbial Remediation Technician',   'Technicien IICRC en assainissement microbien',     'IICRC', NULL, 'DOCUMENT', 'Mold remediation.'),
 ('ASBESTOS_ON', 'Ontario Asbestos Worker Training',                 'Formation ontarienne sur l''amiante',              'Ontario Ministry of Labour', NULL, 'DOCUMENT', NULL),
 ('BIOHAZARD',   'Biohazard / Bloodborne-Pathogen Training',         'Formation risques biologiques / agents pathogènes','—', NULL, 'DOCUMENT', NULL),
 ('LEAD_SAFE',   'Lead-Safe Painting / Lead Remediation Training',   'Formation peinture sans plomb / décontamination',  '—', NULL, 'DOCUMENT', 'Exigido por el cliente para Lead Paint Remediation (L3).'),
 ('SPRAY_FOAM',  'Product-Specific Spray Foam Installer Certification','Certification d''installateur de mousse pulvérisée','Recognized QA program', NULL, 'DOCUMENT', 'Exigido por el cliente para Spray Foam Insulation (L3).'),
 ('BACKFLOW',    'Cross-Connection Control / Backflow Tester',       'Contrôle des raccordements croisés / testeur de refoulement', '—', NULL, 'DOCUMENT', NULL),
 ('OBC_P8',      'OBC Part 8 / BCIN-qualified Septic Provider',      'Fournisseur de fosses septiques qualifié BCIN / CBO partie 8', 'Ontario Ministry of Municipal Affairs and Housing', NULL, 'REGISTRY', NULL),
 ('SEWAGE_HAUL', 'Sewage Hauler Approval',                           'Autorisation de transporteur d''eaux usées',       'MECP', NULL, 'DOCUMENT', NULL),
 ('SMART_SERVE', 'Smart Serve',                                      'Smart Serve',                                      'Smart Serve Ontario', 'Smart Serve Registry', 'REGISTRY', 'Manejo de alcohol.'),
 ('FOOD_HANDLER','Food Handler Certification',                       'Certification de manipulateur d''aliments',        'SafeCheck / FoodSafe4U / ServSafe / FoodPrep / Canadian Food Safety Training', NULL, 'DOCUMENT', NULL),
 ('ISA_ARBORIST','ISA Certified Arborist',                           'Arboriculteur certifié ISA',                       'International Society of Arboriculture', 'ISA Verify', 'REGISTRY', 'Recomendado.')
ON CONFLICT (code) DO NOTHING;

COMMIT;
