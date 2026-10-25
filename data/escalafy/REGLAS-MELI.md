# Reglas de rentabilidad MeLi (copiadas de Escalafy, 24-oct-2026)

Objetivo: replicar el reporte MeLi de Escalafy con la API de ML y dar de baja la membresía.

## Configuración actual en Escalafy
- **Impuestos MeLi**: 5% sobre el monto de la transacción (no se divide por IVA).
- **Quitar IVA**: SÍ, 21%. Venta, devoluciones, comisión ML y envío ML se dividen por 1,21.
  Los costos de producto y de Flex se cargan SIN IVA y no se tocan.
- **Envío Flex / "a acordar"**: tabla por provincia — solo CABA (AR-C) = $3.650, el resto está en 0 (incompleta).
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
