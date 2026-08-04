-- 031_level_zero_enum.sql
-- Reestructuración de niveles L0..L3 — PASO 1: valores de enum.
--
-- Va en su PROPIA migración porque Postgres no permite USAR un valor de enum
-- en la misma transacción en la que se añade. La 032 y la 033 ya pueden usarlos.
--
-- LEVEL_4 NO se elimina del enum (Postgres no permite quitar valores sin recrear
-- el tipo y todas sus columnas). Queda como valor MUERTO: ningún servicio ni
-- proveedor debe usarlo tras la 033.

ALTER TYPE provider_level ADD VALUE IF NOT EXISTS 'LEVEL_0' BEFORE 'LEVEL_1';

-- Consentimientos nuevos del modelo L0..L3.
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'LEVEL_0_TERMS' BEFORE 'LEVEL_1_TERMS';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'SAFETY_LIABILITY_AGREEMENT';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'JOB_SCOPE_ACCEPTANCE';
ALTER TYPE consent_type ADD VALUE IF NOT EXISTS 'UNINSURED_PROVIDER_RISK_DISCLOSURE';
