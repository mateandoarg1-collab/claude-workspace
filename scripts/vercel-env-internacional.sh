#!/bin/zsh
# Carga en Vercel (Production) las credenciales de solo lectura de /internacional, leyéndolas de ~/.claude.
# Lo corre Juampi: zsh ~/claude-workspace/scripts/vercel-env-internacional.sh
set -e
cd ~/claude-workspace
source ~/.claude/.stripe
source ~/.claude/.shopify-intl
for v in STRIPE_KEY SHOPIFY_INTL_CLIENT_ID SHOPIFY_INTL_CLIENT_SECRET; do
  vercel env rm "$v" production -y >/dev/null 2>&1 || true
  printf '%s' "${(P)v}" | vercel env add "$v" production >/dev/null
  echo "✓ $v"
done
echo "Listo. Avisale a Claude."
