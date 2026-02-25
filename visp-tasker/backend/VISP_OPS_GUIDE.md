# 🚀 VISP API - Guía de Operaciones

## Índice
- [Cloudflare Tunnel](#-cloudflare-tunnel)
- [Comandos Docker Esenciales](#-comandos-docker-esenciales)
- [Monitoreo](#-monitoreo)
- [Troubleshooting](#-troubleshooting)
- [Emergencias](#-emergencias)
- [Mantenimiento](#-mantenimiento)

---

## 🌐 Cloudflare Tunnel

### Crear tunnel para la API

```bash
# 1. Crear el tunnel (solo una vez)
cloudflared tunnel create visp-api

# 2. Copiar el archivo de credenciales generado
# Se crea en: ~/.cloudflared/<UUID>.json

# 3. Agregar ruta DNS (reemplaza con tu dominio)
cloudflared tunnel route dns visp-api api.tudominio.com
```

### Configurar el tunnel

Edita `~/.cloudflared/config.yml`:
```yaml
tunnel: visp-api
credentials-file: /home/richie/.cloudflared/<UUID>.json

ingress:
  - hostname: api.tudominio.com
    service: http://localhost:8000
  - service: http_status:404
```

### Iniciar tunnel como servicio

```bash
# Instalar servicio systemd
sudo cloudflared service install

# O ejecutar manualmente
cloudflared tunnel run visp-api
```

### Usar tunnel existente (mi-tunel-rpi)

Si quieres usar tu tunnel existente:
```bash
# Ver configuración actual
cloudflared tunnel info mi-tunel-rpi

# Agregar ruta para la API
cloudflared tunnel route dns mi-tunel-rpi api.tudominio.com

# Actualizar config.yml agregando la ruta de la API
```

---

## 🐳 Comandos Docker Esenciales

### Ubicación del proyecto
```bash
cd /home/richie/ssd/VISP/visp-tasker/backend
```

### Operaciones básicas

| Acción | Comando |
|--------|---------|
| **Iniciar** | `docker compose up -d` |
| **Detener** | `docker compose down` |
| **Reiniciar** | `docker compose restart` |
| **Reiniciar solo backend** | `docker compose restart backend` |
| **Ver estado** | `docker compose ps` |
| **Ver logs** | `docker compose logs -f backend` |
| **Reconstruir** | `docker compose up -d --build` |

### Comandos rápidos (copia-pega)

```bash
# Ver estado de todos los contenedores
docker compose ps

# Logs en tiempo real (Ctrl+C para salir)
docker compose logs -f backend

# Últimas 100 líneas de logs
docker compose logs --tail 100 backend

# Reiniciar backend
docker compose restart backend

# Forzar recreación completa
docker compose down && docker compose up -d --build
```

---

## 📊 Monitoreo

### Health Check rápido
```bash
curl http://localhost:8000/health
# Esperado: {"status":"ok","version":"0.1.0"}
```

### Ver uso de recursos
```bash
# CPU y memoria de contenedores
docker stats --no-stream

# Detallado por contenedor
docker stats visp-backend visp-redis --no-stream
```

### Verificar conexiones
```bash
# Conexiones activas al puerto 8000
ss -tulpn | grep 8000

# Conexiones de red del contenedor
docker exec visp-backend ss -tulpn
```

### Ver logs de errores
```bash
# Solo errores
docker compose logs backend 2>&1 | grep -i error

# Logs de las últimas 2 horas
docker compose logs --since 2h backend
```

### Configurar monitoreo automático

Agregar al crontab:
```bash
crontab -e

# Agregar esta línea (healthcheck cada 5 minutos)
*/5 * * * * /home/richie/ssd/VISP/visp-tasker/backend/scripts/healthcheck.sh
```

---

## 🔧 Troubleshooting

### ❌ API no responde

**Paso 1: Verificar contenedor**
```bash
docker compose ps
# El estado debe ser "Up" y "healthy"
```

**Paso 2: Ver logs**
```bash
docker compose logs --tail 50 backend
```

**Paso 3: Reiniciar**
```bash
docker compose restart backend
sleep 10
curl http://localhost:8000/health
```

### ❌ Error de conexión a PostgreSQL

```bash
# Verificar conectividad
nc -zv 192.168.1.94 5432

# Ver logs de conexión
docker compose logs backend | grep -i "postgres\|database\|connect"

# Verificar variables de entorno
docker exec visp-backend env | grep DATABASE
```

### ❌ Redis no disponible

```bash
# Verificar estado
docker compose ps redis

# Reiniciar Redis
docker compose restart redis

# Verificar conexión
docker exec visp-redis redis-cli ping
# Esperado: PONG
```

### ❌ Contenedor reiniciando constantemente

```bash
# Ver loops de reinicio
docker compose logs --tail 200 backend

# Ver eventos de Docker
docker events --filter container=visp-backend --since 1h
```

### ❌ Alto uso de memoria/CPU

```bash
# Ver recursos
docker stats visp-backend --no-stream

# Reiniciar para liberar memoria
docker compose restart backend
```

### ❌ Espacio en disco lleno

```bash
# Ver uso de disco Docker
docker system df

# Limpiar imágenes no usadas
docker image prune -a

# Limpiar todo (cuidado!)
docker system prune -a
```

---

## 🚨 Emergencias

### Recuperación rápida (copy-paste)

```bash
cd /home/richie/ssd/VISP/visp-tasker/backend

# Opción 1: Reinicio suave
docker compose restart backend

# Opción 2: Reinicio completo
docker compose down && docker compose up -d

# Opción 3: Reconstruir todo desde cero
docker compose down -v
docker compose up -d --build
```

### API completamente caída

```bash
# 1. Detener todo
docker compose down

# 2. Verificar que no hay procesos zombie
docker ps -a | grep visp

# 3. Limpiar si es necesario
docker rm -f visp-backend visp-redis 2>/dev/null

# 4. Reiniciar
docker compose up -d

# 5. Verificar logs
docker compose logs -f backend
```

### Base de datos corrupta o inaccesible

```bash
# Verificar conexión
docker exec visp-backend python3 -c "
import asyncio
import asyncpg
asyncio.run(asyncpg.connect(
    'postgresql://Droz:Droz.2026@192.168.1.94:5432/visp_tasker',
    timeout=5
))
print('✅ Conexión OK')
"
```

### Rollback a versión anterior

```bash
# Ver imágenes disponibles
docker images | grep backend

# Reconstruir sin cache
docker compose build --no-cache backend
docker compose up -d
```

---

## 🔄 Mantenimiento

### Actualizar código

```bash
cd /home/richie/ssd/VISP/visp-tasker/backend

# Obtener cambios (si usas git)
git pull

# Reconstruir imagen
docker compose up -d --build
```

### Backup de logs

```bash
# Exportar logs
docker compose logs backend > backup_logs_$(date +%Y%m%d).txt
```

### Limpieza semanal

```bash
# Limpiar imágenes huérfanas
docker image prune -f

# Limpiar volúmenes no usados (cuidado con datos)
docker volume prune -f
```

### Verificar certificados Cloudflare

```bash
# Ver estado del tunnel
cloudflared tunnel info mi-tunel-rpi

# Ver conexiones activas
cloudflared tunnel info mi-tunel-rpi | grep -i connection
```

---

## 📋 Checklist de Emergencias

- [ ] `docker compose ps` - ¿Contenedores están "Up"?
- [ ] `curl localhost:8000/health` - ¿API responde?
- [ ] `docker compose logs --tail 50 backend` - ¿Hay errores?
- [ ] `docker stats --no-stream` - ¿Recursos normales?
- [ ] `nc -zv 192.168.1.94 5432` - ¿BD accesible?
- [ ] `cloudflared tunnel info mi-tunel-rpi` - ¿Tunnel activo?

---

## 📞 Contactos de Emergencia

| Servicio | Ubicación |
|----------|-----------|
| Backend Docker | `192.168.1.94:8000` |
| PostgreSQL | `192.168.1.94:5432` |
| Redis | `localhost:6379` (contenedor) |
| Swagger UI | `http://192.168.1.94:8000/docs` |
