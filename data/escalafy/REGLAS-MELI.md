# Reglas de rentabilidad MeLi (copiadas de Escalafy, 24-oct-2026)

Objetivo: replicar el reporte MeLi de Escalafy con la API de ML y dar de baja la membresía.

## Configuración actual en Escalafy
- **Impuestos MeLi**: 5% sobre el monto de la transacción (no se divide por IVA).
- **Quitar IVA**: SÍ, 21%. Venta, devoluciones, comisión ML y envío ML se dividen por 1,21.
  Los costos de producto y de Flex se cargan SIN IVA y no se tocan.
- **Envío Flex / "a acordar"**: tabla por provincia. En Escalafy solo está CABA (AR-C) = $3.650, el resto en 0.
  Tarifas reales que pasó Juampi (24-oct-2026), **netas de IVA**, para nuestro panel:
  - CABA: $3.400 · Cordón 1: $5.200 · Cordón 2: $6.500 · Cordón 3: $8.000
  - El cordón sale del código postal del envío Flex. Si no matchea un cordón, cae a "Buenos Aires" genérico (AR-B), que hoy está sin tarifa.
  Mercado Envíos y Full: lo que cobra ML al vendedor en el envío (ya neto de bonificaciones).
- **Costos adicionales**:
  - NUBIMETRICS: $101.035/mes fijo (÷30 por día), desde 1-sep-2025.
  - PICHÓN: 2% de la venta MeLi desde 1-oct-2026, contado como **inversión publicitaria** (se suma a la pauta, no a los costos).
- **Costo de producto**: `costos-meli.csv` (680 publicaciones/variantes, todo en ARS fijo).
  20 activas sin costo (termos Mateando, set latas, mates Día de la Madre, Torpedo croco, etc.) → hoy cuentan con costo 0.
  Ojo: los costos tienen fecha; las órdenes viejas se valoran con el costo vigente en su fecha.

## Fórmulas (por orden, se agregan por día)
- `venta` = transaction_amount − reembolsado − descuentos del vendedor (solo paid / partially_refunded) → ÷1,21
- `comisión` = Σ sale_fee × cantidad (incluye cuotas y MP), proporcional si hay reembolso → ÷1,21
- `envío` = costo ML del envío (÷1,21) + Flex por tabla + costo de envío de devolución; un carrito reparte el envío según el monto de cada orden
- `impuestos` = venta bruta × 5%
- `costo` = Σ cantidad × costo unitario (si la devolución volvió a stock, sale de COGS)
- `neto` = venta − comisión − costo − envío − impuestos
- `pauta` = gasto en ML Ads + 2% de Pichón
- `ganancia` = neto − pauta − adicionales (Nubimetrics prorrateado)
- Cancelada antes de despachar → todo en 0. Devuelta después del despacho → el envío queda como pérdida y solo se revierte la comisión.
- `ROAS` = ventas atribuidas ML Ads / pauta · `True ROAS` = (neto / venta) × ROAS

## Réplica propia (24-oct-2026) — /rentabilidad-meli
- `scripts/meli-rentabilidad.mjs` (launchd `com.mateando.meli-rentabilidad`, cada hora: 3 días; a las 6 AM: 45 días) → pestañas `rentabilidad_meli` y `rentabilidad_meli_ads` de MATEANDO MAYORISTA 2026.
- Detalles que hubo que copiar para que coincida:
  - Venta = total − reembolsos − **cupones que paga el vendedor** (`/orders/{id}/discounts`, type coupon, amounts.seller). Los descuentos "discount" (ofertas) ya vienen en el precio.
  - Flex (corregido 24-oct): ML **no cobra** el envío Flex (el pago en MP no tiene `shp_*` y la facturación no tiene CXD/CFF), aunque `/shipments/{id}/costs` muestre `senders.cost`. Al revés, paga: `senders.save` (10%) + descuento `loyal` del comprador (envío gratis que banca ML) — llegan como transferencias MP "bonificaciones_flex_fc" — + el envío que pagó el comprador (`receiver.cost`, viene en el pago). Todo eso se resta del envío ML. Escalafy en cambio cobraba `senders.cost` menos un promedio por zona.
  - Devoluciones con reclamo despachadas: se suma lo que ML le cobra al vendedor por el envío de vuelta.
  - `/orders/search` repite órdenes entre páginas → se deduplica y se consulta de a 3 horas.
- Validación oct 1–23 contra el dashboard de Escalafy: venta 133,68 M vs 133,62 M · comisión 28,63 vs 28,62 · impuestos 8,09 vs 8,08 · pauta igual · costo 41,02 vs 41,33 · envío ML 12,23 vs 12,43 · Flex 5,56 vs 5,69.
- **Escalafy NO resta el Flex propio en su neto ni en su ganancia** (muestra `meli_private_shipping` pero `meli_net_revenue` no lo descuenta).
- Conciliación oct 1–24: Escalafy ganancia 26,64 M → nuestra 24,40 M. Envío ML +5,82 M (Escalafy cobra un Flex que ML no cobra y no suma lo que ML paga) · Flex propio −5,62 M (Escalafy no lo resta) · costo +0,31 M · Pichón −2,71 M y Nubimetrics −0,08 M (Escalafy no los resta en la ganancia de MeLi).
- Costos de producto: hoy se copian de Escalafy a `costos_meli` (`scripts/costos-meli-a-planilla.mjs`). Al dar de baja Escalafy, esa pestaña pasa a ser la fuente y se edita a mano.
