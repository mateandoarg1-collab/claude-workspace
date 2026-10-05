import { fetchItemMeta, fetchOrdersInRange, isValidOrder } from '@/lib/ml';

export const maxDuration = 30;

// Unidades de productos importados de China vendidas por día en el mes en curso (hora AR).
export async function GET() {
  try {
    const now = new Date();
    // Hora AR = UTC - 3.
    const arNow = new Date(now.getTime() - 3 * 3600 * 1000);
    const arYear = arNow.getUTCFullYear();
    const arMonth = arNow.getUTCMonth();
    const today = arNow.getUTCDate();
    const daysInMonth = new Date(Date.UTC(arYear, arMonth + 1, 0)).getUTCDate();
    const from = new Date(Date.UTC(arYear, arMonth, 1, 3, 0, 0));

    const orders = (await fetchOrdersInRange(from, now)).filter(isValidOrder);
    const ids = Array.from(new Set(orders.flatMap((o) => o.order_items.map((it) => it.item.id))));
    const meta = await fetchItemMeta(ids);

    const days = Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, qty: 0, revenue: 0 }));
    orders.forEach((o) => {
      const arDay = new Date(new Date(o.date_created).getTime() - 3 * 3600 * 1000).getUTCDate();
      o.order_items.forEach((it) => {
        if (!meta.get(it.item.id)?.isChina) return;
        days[arDay - 1].qty += it.quantity;
        days[arDay - 1].revenue += it.quantity * it.unit_price;
      });
    });

    return Response.json({
      generated_at: now.toISOString(),
      year: arYear,
      month: arMonth + 1,
      today,
      days,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
