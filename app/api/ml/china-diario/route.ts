import { fetchItemMeta, fetchOrdersInRange, fetchThumbnails, isValidOrder } from '@/lib/ml';

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
    // Desglose por publicación (cada color es un item) con sus unidades por día, para filtrar por día en el front.
    type Prod = { id: string; title: string; color: string | null; qty: number; revenue: number; daily: Record<number, { qty: number; revenue: number }> };
    const prods = new Map<string, Prod>();
    orders.forEach((o) => {
      const arDay = new Date(new Date(o.date_created).getTime() - 3 * 3600 * 1000).getUTCDate();
      o.order_items.forEach((it) => {
        if (!meta.get(it.item.id)?.isChina) return;
        const rev = it.quantity * it.unit_price;
        days[arDay - 1].qty += it.quantity;
        days[arDay - 1].revenue += rev;

        const color = it.item.variation_attributes?.find((a) => a.id === 'COLOR')?.value_name ?? meta.get(it.item.id)?.color ?? null;
        const p = prods.get(it.item.id) ?? { id: it.item.id, title: it.item.title, color, qty: 0, revenue: 0, daily: {} };
        p.qty += it.quantity;
        p.revenue += rev;
        const d = (p.daily[arDay] ??= { qty: 0, revenue: 0 });
        d.qty += it.quantity;
        d.revenue += rev;
        prods.set(it.item.id, p);
      });
    });

    const sorted = Array.from(prods.values()).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
    const thumbs = await fetchThumbnails(sorted.map((p) => p.id));
    const products = sorted.map((p) => ({ ...p, thumbnail: thumbs.get(p.id) || null }));

    return Response.json({
      generated_at: now.toISOString(),
      year: arYear,
      month: arMonth + 1,
      today,
      days,
      products,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
