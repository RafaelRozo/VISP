-- 048 — La base del proveedor vuelve a ser su DIRECCIÓN, no el GPS del teléfono.
--
-- `POST /users/me/location` escribía `provider_profiles.home_latitude/longitude`
-- con la posición del dispositivo. La app llama a esa ruta al arrancar y en cada
-- actualización de posición durante un trabajo activo, así que la base del
-- proveedor —desde la que el matching mide la distancia— seguía al teléfono:
-- viajar bastaba para dejar de recibir trabajos de tu propia ciudad, y probar
-- desde fuera de Canadá te sacaba del mercado entero.
--
-- Con la escritura ya retirada del backend, aquí se repara el dato: la única
-- fuente legítima de la base es la dirección declarada, que además pasa por el
-- gate de zona de servicio al guardarse.
--
-- Solo toca las filas donde la dirección existe y NO coincide con la base
-- guardada (tolerancia de ~11 m, que es el redondeo de 4 decimales). Los
-- proveedores sin dirección declarada se quedan como están: no hay nada mejor
-- con lo que sustituirlos.

UPDATE provider_profiles p
SET home_latitude  = u.default_address_latitude,
    home_longitude = u.default_address_longitude,
    updated_at     = NOW()
FROM users u
WHERE u.id = p.user_id
  AND u.default_address_latitude IS NOT NULL
  AND u.default_address_longitude IS NOT NULL
  AND (
        p.home_latitude IS NULL
     OR p.home_longitude IS NULL
     OR ABS(p.home_latitude  - u.default_address_latitude)  > 0.0001
     OR ABS(p.home_longitude - u.default_address_longitude) > 0.0001
  );
