# CMV de Empretienda (Tienda Online y Local)

`scripts/empretienda-metricas.mjs` (GitHub Actions, cada 30 min) baja en Métricas → "Listado de productos" →
"Descargar listado" el Excel de cada período (total y Acordar) y corre `cmv.py`, que traduce cada publicación +
variante a SKUs (`reglas.py`) y les pone costo. Resultado: pestaña `cmv_empretienda` de la planilla MATEANDO
MAYORISTA 2026 (la lee /canales) y `cmv_revisar` (publicaciones nuevas sin regla: agregarlas en `reglas.py`).

Costos, de menor a mayor prioridad:
1. `costos_base.json` (foto de oct-2026, por si falla la planilla)
2. `costos_override.json`: lo que la planilla no tiene (cajas de despacho Lumapack sin IVA + cinta `DESP-*`,
   discontinuados, kits, Mate Flow…). Desde el 28-oct-2026 NO le gana a la planilla (pedido de Juampi: su Excel manda).
3. Planilla "Costos JP - meli" (`1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8`, col F SKU, col G costo neto): manda.
4. Por producto, cargado a mano en /rentabilidad-tienda/costos (pestaña `costos_tienda`: nombre de Empretienda → costo
   sin IVA). Reemplaza el costo de los SKUs del producto (sirve para productos nuevos sin regla); se le siguen sumando lo
   que agrega la variante (bombilla, caja o bolsa de regalo) y el packaging. Llega a `cmv.py` y `cmv_orden.py` como
   `costos["_productos"]`.

Packaging (definido por JP, oct-2026):
- Tienda Online: cada mate sin "Caja de regalo: SI" lleva `PACK-CUR-11018` (packaging general); con caja de regalo
  va `PACK-CAJ-11003`. Una caja de despacho por pedido (cantidad de ventas de Métricas), con el costo promedio de caja
  (simple, 2x1, set, termo) de lo que se vendió.
- Local (Acordar, retiro en Palermo): sin despacho, 1 bolsa `PACK-BOL-11001` por pedido.
- Meli no usa esto: sus costos vienen de Escalafy por MLA (pestaña `costos_meli`, `scripts/costos-meli-a-planilla.mjs`).
- Shopify (`lib/shopify.ts` getShopifyCmv): SKU de cada producto vendido × mismos costos (`getCostosSku` en `lib/sheets.ts`); la app solo tiene read_orders.
