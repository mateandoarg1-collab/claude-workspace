#!/bin/bash
# Una lectura de Métricas de Empretienda en el servidor de DonWeb (Imperva no lo bloquea). La corre cron cada 30 min
# (ver README.md). Trae la última versión del repo antes de leer, así los cambios del lector o del CMV llegan solos.
echo "== $(date '+%F %T')"
cd /root/claude-workspace || exit 1
git fetch -q && git reset -q --hard origin/main || echo "No pude actualizar el repo, sigo con lo que hay"
# mismo perfil de Empretienda que el tildador (una sola sesión iniciada a mano): se turnan con el candado
export DISPLAY=:99 EMPRETIENDA_PERFIL=/root/tildar_profile
GOOGLE_SERVICE_ACCOUNT_KEY="$(cat /root/mateando/sa.json)" || exit 1
export GOOGLE_SERVICE_ACCOUNT_KEY
salida=$(flock -w 900 /root/mateando/.navegador timeout 25m node scripts/empretienda-metricas.mjs 2>&1); codigo=$?
echo "$salida"
# si se cerró la sesión, avisar por mail (como mucho cada 12 h): hay que iniciarla de nuevo a mano por el captcha
if echo "$salida" | grep -q "Se cerró la sesión de Empretienda"; then
  python3 scripts/servidor/avisar.py sesion "Panel: se cerró la sesión de Empretienda del servidor" \
    "El servidor no puede leer Métricas ni tildar comprobantes hasta que se inicie sesión de nuevo en Empretienda (captcha). Pedile a Claude que abra la ventana del servidor." || true
fi
exit $codigo
