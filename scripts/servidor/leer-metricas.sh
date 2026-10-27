#!/bin/bash
# Una lectura de Métricas de Empretienda en el servidor. La corre cron cada 30 min (ver README.md).
# Trae la última versión del repo antes de leer, así los cambios del lector o de las reglas de CMV llegan solos.
echo "== $(date '+%F %T')"
cd /root/claude-workspace || exit 1
git fetch -q && git reset -q --hard origin/main || echo "No pude actualizar el repo, sigo con lo que hay"
export DISPLAY=:99 EMPRETIENDA_PERFIL=/root/mateando/perfil
GOOGLE_SERVICE_ACCOUNT_KEY="$(cat /root/mateando/sa.json)" || exit 1
export GOOGLE_SERVICE_ACCOUNT_KEY
# el perfil no se puede abrir dos veces: si hay un inicio de sesión a mano en curso, esta vuelta se saltea
exec flock -n /root/mateando/.navegador timeout 25m node scripts/empretienda-metricas.mjs
