import { fetchAdsCost, fetchOrdersInRange, isValidOrder } from '@/lib/ml';
import { desdeAR, finAR, hastaAR, inicioAR, parsePeriodo } from '@/lib/periodo';

export const maxDuration = 30;

// Ventas de Mercado Libre del período (?periodo=hoy|ayer|semana|mes), contadas como /api/ml/sales.
export async function GET(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const [all, ads] = await Promise.all([
      fetchOrdersInRange(inicioAR(desdeAR(periodo)), finAR(periodo)),
      fetchAdsCost(desdeAR(periodo), hastaAR(periodo)).catch(() => null), // si falla publicidad, no romper ventas
    ]);
    const orders = all.filter(isValidOrder);
    return Response.json({
      orders: new Set(orders.map((o) => o.pack_id ?? o.id)).size,
      amount: orders.reduce((s, o) => s + (o.total_amount || 0), 0),
      ads,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
