-- 034_credential_requirement_kind.sql
-- Añade el seguro de responsabilidad civil comercial (CGL) al catálogo de
-- requisitos, y con él la distinción de QUÉ TIPO de requisito es cada código.
--
-- El catálogo mezclaba tres cosas que el motor tiene que verificar en sitios
-- distintos:
--   * CREDENTIAL — credencial del proveedor (306A, ESA_LEC, Smart Serve...).
--                  Se verifica en provider_credentials + provider_credential_codes.
--   * INSURANCE  — póliza. Vive en provider_insurance_policies, no es una
--                  credencial: tiene asegurado, operaciones cubiertas, monto y
--                  vigencia. El motor NO debe buscarla en provider_credentials.
--   * PERMIT     — permiso ligado AL TRABAJO, no al proveedor (building permit).
--                  No se puede "tener" de antemano; se exige por reserva.
--
-- Nota: level_policy.requires_insurance ya exige CGL para TODO L2 y L3. El
-- código CGL por servicio no lo sustituye — lo hace explícito en la ficha del
-- servicio y permite exigirlo también en un servicio L0/L1 concreto.
--
-- Requiere la 032 aplicada.

BEGIN;

DO $$ BEGIN
    CREATE TYPE credential_requirement_kind AS ENUM ('CREDENTIAL', 'INSURANCE', 'PERMIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE credential_requirements
    ADD COLUMN IF NOT EXISTS kind credential_requirement_kind
        NOT NULL DEFAULT 'CREDENTIAL';

-- El permiso de construcción es del trabajo, no del proveedor.
UPDATE credential_requirements SET kind = 'PERMIT', updated_at = NOW()
 WHERE code = 'BUILDING_PERMIT';

-- Seguro de responsabilidad civil comercial.
INSERT INTO credential_requirements
    (code, label_en, label_fr, authority, registry_name, registry_url,
     verification_method, kind, description)
VALUES (
    'CGL',
    'Commercial General Liability insurance',
    'Assurance responsabilité civile générale commerciale',
    'Insurer',
    NULL,
    NULL,
    'DOCUMENT',
    'INSURANCE',
    'Póliza CGL vigente que cubra los servicios ofrecidos a través de VISP. '
    'El nombre asegurado, las operaciones cubiertas, el monto y las fechas de '
    'vigencia deben coincidir con la cuenta del proveedor o de la empresa. '
    'Obligatoria para todo L2 y L3 por política de nivel (level_policy.requires_insurance).'
)
ON CONFLICT (code) DO UPDATE SET
    kind = EXCLUDED.kind,
    label_en = EXCLUDED.label_en,
    label_fr = EXCLUDED.label_fr,
    description = EXCLUDED.description,
    updated_at = NOW();

COMMIT;
