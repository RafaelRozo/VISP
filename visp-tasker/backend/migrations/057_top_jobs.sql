-- 057 · Top Jobs: servicios destacados en "My Services" del proveedor
--
-- El cliente quiere un punto de entrada para los trabajos que más se piden, para
-- que el proveedor nuevo los encuentre sin abrir categoría por categoría. Lo
-- decide el admin desde la página "Top Jobs" del panel.
--
-- NO es un nivel nuevo ni toca precio, nivel o requisitos: es solo una marca de
-- presentación sobre filas que ya existen en `service_tasks`. El servicio sigue
-- saliendo también en su categoría. `top_job_order` fija el orden de la lista.
--
-- Lista inicial (2026-10-19): las dos listas "Tier A - Top Jobs" del cliente, unidas.

BEGIN;

ALTER TABLE service_tasks
    ADD COLUMN IF NOT EXISTS is_top_job    BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS top_job_order INTEGER;

UPDATE service_tasks t
   SET is_top_job    = TRUE,
       top_job_order = v.ord,
       updated_at    = now()
  FROM (VALUES
        ('standard-residential-cleaning',   1),
        ('move-out-cleaning',               2),
        ('ikea-furniture-assembly',         3),
        ('bed-frame-assembly',              4),
        ('desk-assembly',                   5),
        ('bookshelf-assembly',              6),
        ('leaf-raking-yard-cleanup',        7),
        ('lawn-mowing',                     8),
        ('dog-walking-30',                  9),
        ('small-item-moving-same-building', 10),
        ('furniture-rearrangement',         11),
        ('local-apartment-move-small',      12),
        ('tv-wall-mount-no-wiring',         13),
        ('blinds-curtain-rod-installation', 14)
       ) AS v(slug, ord)
 WHERE t.slug = v.slug;

COMMIT;
