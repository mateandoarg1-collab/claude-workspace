#!/bin/zsh
# Guarda las credenciales de la Shopify internacional (mateando-com) en ~/.claude/.shopify-intl
# Se tipean a mano, no se muestran en pantalla.
read -s "ID?Pegá el ID de cliente y Enter: "; echo
read -s "SEC?Pegá el Secreto del cliente y Enter: "; echo
printf 'SHOPIFY_INTL_SHOP=mateando-com.myshopify.com\nSHOPIFY_INTL_CLIENT_ID=%s\nSHOPIFY_INTL_CLIENT_SECRET=%s\n' "$ID" "$SEC" > ~/.claude/.shopify-intl
chmod 600 ~/.claude/.shopify-intl
echo "Guardado OK (${#ID} y ${#SEC} caracteres)"
