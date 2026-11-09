#!/bin/bash
# Rentabilidad de la Tienda (scripts/tienda-rentabilidad.mjs) en el servidor de DonWeb, cada hora (a las 6 recalcula
# 60 días). Antes corría en launchd de la Mac y se frenaba con la Mac apagada. Claves en /root/mateando/claves.
echo "== $(date '+%F %T')"
cd /root/claude-workspace || exit 1
# corre a los 22 de cada hora: no se cruza con leer-metricas.sh (7 y 37), que también actualiza el repo
git fetch -q && git reset -q --hard origin/main || echo "No pude actualizar el repo, sigo con lo que hay"
MATEANDO_CLAVES=/root/mateando/claves timeout 20m node scripts/tienda-rentabilidad.mjs
MATEANDO_CLAVES=/root/mateando/claves timeout 10m node scripts/local-rentabilidad.mjs
