-- 053 · Comprobantes de trabajo (factura del cliente + liquidación del proveedor)
--
-- Se emite uno de cada al CAPTURAR el cobro, que es cuando las cifras quedan
-- congeladas. Antes no: hasta la captura el importe puede cambiar por
-- materiales o por un sobrecoste aprobado, y un comprobante que cambia no es
-- un comprobante.
--
-- Igual que `legal_consents`, esto es APPEND-ONLY: un documento emitido no se
-- edita ni se borra. Si hay un reembolso se emite otro documento, no se toca
-- el anterior. Por eso no hay `updated_at`.

BEGIN;

-- La serie es de VISP y correlativa (decisión de Ricardo, 2026-09-25). La
-- unicidad la garantiza POSTGRES, no el código: dos trabajos que se capturan
-- en el mismo instante no pueden compartir número, y un SELECT MAX()+1 en
-- Python sí lo permitiría.
CREATE SEQUENCE IF NOT EXISTS visp_invoice_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS job_invoices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id        UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    -- 'customer' = factura del servicio · 'provider' = liquidación del pago.
    -- Son documentos distintos con cifras distintas y cada parte ve SOLO el
    -- suyo: en la liquidación va la comisión de VISP y el neto del proveedor,
    -- que no es asunto del cliente.
    kind          VARCHAR(16) NOT NULL CHECK (kind IN ('customer', 'provider')),

    -- Número visible, p. ej. 'VISP-2026-000412' y '...-P' para el proveedor.
    number        VARCHAR(32) NOT NULL UNIQUE,

    -- El fichero y su huella. El hash permite demostrar que el PDF que alguien
    -- guardó es el que emitimos.
    document_path VARCHAR(500) NOT NULL,
    document_hash VARCHAR(64)  NOT NULL,

    -- Foto de las cifras en el momento de emitir. Se guarda aparte de `jobs`
    -- a propósito: si mañana se corrige una columna del trabajo, el
    -- comprobante ya emitido debe seguir contando lo que contaba.
    totals_json   JSONB NOT NULL DEFAULT '{}'::jsonb,

    currency      VARCHAR(3) NOT NULL DEFAULT 'CAD',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un solo documento de cada tipo por trabajo. Si la captura se reintenta, no
-- se emiten dos facturas con números distintos para el mismo cobro.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_invoice_kind
    ON job_invoices (job_id, kind);

CREATE INDEX IF NOT EXISTS ix_job_invoices_job ON job_invoices (job_id);

COMMIT;
