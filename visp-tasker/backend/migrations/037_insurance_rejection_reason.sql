-- 037_insurance_rejection_reason.sql
-- v1 L0/L1 (WP1b) — motivo de rechazo en las pólizas de seguro.
--
-- `provider_credentials` sí tiene `rejection_reason`, pero
-- `provider_insurance_policies` no lo tenía. Sin esta columna, la ruta de
-- rechazo del admin asignaría el motivo a un atributo NO MAPEADO: SQLAlchemy lo
-- acepta en silencio, no lanza error, y el texto simplemente se pierde. El
-- proveedor vería su póliza rechazada sin saber por qué y volvería a subir lo
-- mismo.

ALTER TABLE provider_insurance_policies
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMENT ON COLUMN provider_insurance_policies.rejection_reason IS
    'Por qué el admin rechazó la póliza. Se le muestra al proveedor para que '
    'pueda corregir en vez de reintentar a ciegas.';
