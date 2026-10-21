# CMV de Empretienda (Tienda Online y Local)

`scripts/empretienda-metricas.mjs` (GitHub Actions, cada 30 min) baja en Métricas → "Listado de productos" →
"Descargar listado" el Excel de cada período (total y Acordar) y corre `cmv.py`, que traduce cada publicación +
variante a SKUs (`reglas.py`) y les pone costo. Resultado: pestaña `cmv_empretienda` de la planilla MATEANDO
MAYORISTA 2026 (la lee /canales) y `cmv_revisar` (publicaciones nuevas sin regla: agregarlas en `reglas.py`).

Costos, de menor a mayor prioridad:
1. `costos_base.json` (foto de oct-2026, por si falla la planilla)
2. Planilla "Costos JP - meli" (`1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8`, col F SKU, col G costo neto)
3. `costos_override.json`: productos del container (costo Escalafy sin los $500 de packaging de Meli), kits,
   packaging y cajas de despacho Lumapack sin IVA + cinta (`DESP-*`).

Packaging (definido por JP, oct-2026):
- Tienda Online: cada mate sin "Caja de regalo: SI" lleva `PACK-CUR-11018` (packaging general); con caja de regalo
  va `PACK-CAJ-11003`. Cada unidad una caja de despacho según el producto (simple, 2x1, set, termo).
- Local (Acordar, retiro en Palermo): sin despacho, 1 bolsa `PACK-BOL-11001` por pedido.
- Meli no usa esto: sus costos vienen de Escalafy por MLA (pestaña `costos_meli`, `scripts/costos-meli-a-planilla.mjs`).
- Shopify (`lib/shopify.ts` getShopifyCmv): SKU de cada producto vendido × mismos costos (`getCostosSku` en `lib/sheets.ts`); la app solo tiene read_orders.
