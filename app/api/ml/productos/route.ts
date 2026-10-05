import { fetchItemMeta, fetchOrdersInRange, fetchThumbnails, isValidOrder } from '@/lib/ml';

export const maxDuration = 30;

const RANGE_KEYS = ['today', '7d', '15d', '30d', 'month', 'prev_month', 'year'] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

function computeRange(key: RangeKey, now: Date): { from: Date; to: Date } {
  // Hora AR = UTC - 3.
  const arNow = new Date(now.getTime() - 3 * 3600 * 1000);
  const arYear = arNow.getUTCFullYear();
  const arMonth = arNow.getUTCMonth();
  const arDay = arNow.getUTCDate();
  const todayStart = new Date(Date.UTC(arYear, arMonth, arDay, 3, 0, 0));
  const monthStart = new Date(Date.UTC(arYear, arMonth, 1, 3, 0, 0));

  switch (key) {
    case 'today':
      return { from: todayStart, to: now };
    case '7d':
      return { from: new Date(todayStart.getTime() - 6 * 24 * 3600 * 1000), to: now };
    case '15d':
      return { from: new Date(todayStart.getTime() - 14 * 24 * 3600 * 1000), to: now };
    case '30d':
      return { from: new Date(todayStart.getTime() - 29 * 24 * 3600 * 1000), to: now };
    case 'month':
      return { from: monthStart, to: now };
    case 'prev_month': {
      const prevStart = new Date(Date.UTC(arYear, arMonth - 1, 1, 3, 0, 0));
      const prevEnd = new Date(monthStart.getTime() - 1000);
      return { from: prevStart, to: prevEnd };
    }
    case 'year':
      return { from: new Date(Date.UTC(arYear, 0, 1, 3, 0, 0)), to: now };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rangeParam = url.searchParams.get('range') ?? 'month';
    const range: RangeKey = (RANGE_KEYS as readonly string[]).includes(rangeParam)
      ? (rangeParam as RangeKey)
      : 'month';

    const now = new Date();
    const { from, to } = computeRange(range, now);

    const orders = await fetchOrdersInRange(from, to);
    const valid = orders.filter(isValidOrder);

    // Cada publicación de ML es un color (user product), así que agrupamos por item.id
    // y mostramos el color aparte para distinguir p. ej. Termo 1 L Rosa de Termo 1 L Negro.
    const map = new Map<string, { id: string; title: string; color: string | null; qty: number; revenue: number }>();
    valid.forEach((o) => {
      o.order_items.forEach((it) => {
        const key = it.item.id;
        const color = it.item.variation_attributes?.find((a) => a.id === 'COLOR')?.value_name ?? null;
        const row = map.get(key) ?? { id: key, title: it.item.title, color, qty: 0, revenue: 0 };
        row.qty += it.quantity;
        row.revenue += it.quantity * it.unit_price;
        map.set(key, row);
      });
    });

    const sorted = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const ids = sorted.map((p) => p.id);
    const [thumbs, meta] = await Promise.all([fetchThumbnails(ids), fetchItemMeta(ids)]);
    const products = sorted.map((p) => ({
      ...p,
      color: p.color ?? meta.get(p.id)?.color ?? null,
      is_china: meta.get(p.id)?.isChina ?? false,
      thumbnail: thumbs.get(p.id) || null,
    }));

    return Response.json({
      generated_at: now.toISOString(),
      range,
      from: from.toISOString(),
      to: to.toISOString(),
      products,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
