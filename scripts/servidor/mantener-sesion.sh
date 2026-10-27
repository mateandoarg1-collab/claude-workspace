#!/bin/bash
# Renueva la sesión de Empretienda y la sube a GitHub. La corre cron cada 30 min (ver README.md).
# Trae la última versión del repo antes, así los cambios llegan solos.
echo "== $(date '+%F %T')"
cd /root/claude-workspace || exit 1
git fetch -q && git reset -q --hard origin/main || echo "No pude actualizar el repo, sigo con lo que hay"
export DISPLAY=:99 EMPRETIENDA_PERFIL=/root/mateando/perfil
GH_TOKEN="$(cat /root/mateando/gh-token)" || exit 1
export GH_TOKEN
# el perfil no se puede abrir dos veces: si hay un inicio de sesión a mano en curso, esta vuelta se saltea
exec flock -n /root/mateando/.navegador timeout 5m node scripts/servidor/mantener-sesion.mjs
