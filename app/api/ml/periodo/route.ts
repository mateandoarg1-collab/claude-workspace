import { fetchAdsCost, fetchOrdersInRange, isValidOrder } from '@/lib/ml';
import { getCostosMeli } from '@/lib/sheets';
import { desdeAR, finAR, hastaAR, inicioAR, parsePeriodo } from '@/lib/periodo';

export const maxDuration = 30;

// Ventas de Mercado Libre del período (?periodo=hoy|ayer|semana|mes), contadas como /api/ml/sales.
export async function GET(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const [all, ads, costos] = await Promise.all([
      fetchOrdersInRange(inicioAR(desdeAR(periodo)), finAR(periodo)),
      fetchAdsCost(desdeAR(periodo), hastaAR(periodo)).catch(() => null), // si falla publicidad, no romper ventas
      getCostosMeli().catch(() => null),
    ]);
    const orders = all.filter(isValidOrder);
    // CMV con los costos de Escalafy (pestaña costos_meli): fijo por unidad, o % del precio de venta.
    let cmv: number | null = null;
    let sinCosto = 0;
    if (costos) {
      cmv = 0;
      for (const o of orders) {
        for (const oi of o.order_items) {
          const c = costos.get(`${oi.item.id}|${oi.item.variation_id}`) ?? costos.get(oi.item.id);
          if (!c || !c.costo) sinCosto += oi.quantity;
          else cmv += (c.tipo === '%' ? (oi.unit_price * c.costo) / 100 : c.costo) * oi.quantity;
        }
      }
      cmv = Math.round(cmv);
    }
    return Response.json({
      orders: new Set(orders.map((o) => o.pack_id ?? o.id)).size,
      amount: orders.reduce((s, o) => s + (o.total_amount || 0), 0),
      ads,
      cmv,
      sinCosto,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
