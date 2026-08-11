-- 036_service_zones.sql
-- v1 L0/L1 — zona de servicio delimitada (modelo Uber: centro + radio).
--
-- POR QUÉ NO ES UN FILTRO POR PROVINCIA:
-- el cliente quiere un entorno controlado con los servicios "en rango" y evitar
-- un registro aislado a mucha distancia del resto. Ontario mide más de 1.000 km
-- (Toronto-Thunder Bay son 1.400 km), así que filtrar por provincia deja pasar
-- exactamente el problema que se quiere evitar. Se delimita por centro + radio y
-- se amplía añadiendo filas, sin deploy.
--
-- El gate se aplica sobre la DIRECCIÓN donde ocurre el trabajo y sobre la
-- dirección base del proveedor, NO sobre el GPS del dispositivo: el GPS bloquea
-- el testeo propio, se falsea trivialmente, y un cliente de viaje debe poder
-- reservar para su casa dentro de la zona.

CREATE TABLE IF NOT EXISTS service_zones (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(40)   NOT NULL UNIQUE,
    name_en         VARCHAR(120)  NOT NULL,
    name_fr         VARCHAR(120)  NOT NULL,

    -- Centro y radio. Radio en km para que sea legible por un humano en el admin.
    center_latitude  NUMERIC(10, 7) NOT NULL,
    center_longitude NUMERIC(10, 7) NOT NULL,
    radius_km        NUMERIC(6, 2)  NOT NULL CHECK (radius_km > 0),

    -- Jurisdicción de la zona. Informativa/fiscal: el gate geográfico es el radio,
    -- no esta columna.
    country          CHAR(2)       NOT NULL DEFAULT 'CA',
    province_state   VARCHAR(10)   NOT NULL,

    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_zones_active
    ON service_zones (is_active) WHERE is_active;

COMMENT ON TABLE service_zones IS
    'Zonas de operación activas. Un job solo se puede crear si su dirección de '
    'servicio cae dentro del radio de alguna zona activa. Ampliar = insertar fila.';
COMMENT ON COLUMN service_zones.province_state IS
    'Jurisdicción informativa/fiscal. El gate geográfico es centro+radio, no esta columna.';

-- Zona semilla: GTA. Centro en el centro de Toronto. 60 km cubren Mississauga,
-- Brampton, Markham, Vaughan, Richmond Hill, Oakville, Pickering y también
-- Hamilton (59,2 km, entra justo). Barrie queda 25 km fuera: si el cliente la
-- quiere dentro, se sube el radio a 90 desde el admin, sin deploy.
INSERT INTO service_zones (code, name_en, name_fr, center_latitude, center_longitude,
                           radius_km, country, province_state, notes)
VALUES ('GTA', 'Greater Toronto Area', 'Grand Toronto',
        43.6532, -79.3832, 60, 'CA', 'ON',
        'Zona de lanzamiento de la v1 beta. Ampliar el radio o añadir zonas nuevas '
        'según crezca la oferta.')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Normalización de provincia: la columna mezclaba nombre completo y código
-- ('Ontario'=12 filas, 'ON'=1), lo que hace que cualquier filtro por provincia
-- falle en silencio. Se normaliza a código de 2 letras.
-- Los valores que no son provincias canadienses (p.ej. 'Chihuahua', de las
-- pruebas desde México) se DEJAN INTACTOS a propósito: no se inventa un código
-- para datos que no lo tienen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION normalize_ca_province(v TEXT) RETURNS TEXT AS $$
    SELECT CASE lower(btrim(coalesce(v, '')))
        WHEN 'ontario'                   THEN 'ON'
        WHEN 'quebec'                    THEN 'QC'
        WHEN 'québec'                    THEN 'QC'
        WHEN 'british columbia'          THEN 'BC'
        WHEN 'alberta'                   THEN 'AB'
        WHEN 'manitoba'                  THEN 'MB'
        WHEN 'saskatchewan'              THEN 'SK'
        WHEN 'nova scotia'               THEN 'NS'
        WHEN 'new brunswick'             THEN 'NB'
        WHEN 'newfoundland and labrador' THEN 'NL'
        WHEN 'prince edward island'      THEN 'PE'
        WHEN 'yukon'                     THEN 'YT'
        WHEN 'northwest territories'     THEN 'NT'
        WHEN 'nunavut'                   THEN 'NU'
        ELSE v
    END;
$$ LANGUAGE SQL IMMUTABLE;

UPDATE jobs
   SET service_province_state = normalize_ca_province(service_province_state)
 WHERE service_province_state IS NOT NULL
   AND service_province_state <> normalize_ca_province(service_province_state);

UPDATE provider_profiles
   SET home_province_state = normalize_ca_province(home_province_state)
 WHERE home_province_state IS NOT NULL
   AND home_province_state <> normalize_ca_province(home_province_state);
