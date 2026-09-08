import { fetchOrdersInRange, isValidOrder, mlFetch } from '@/lib/ml';

export const maxDuration = 30;

type ItemThumbBody = { id: string; thumbnail?: string; secure_thumbnail?: string };
type MultigetResult = { code: number; body: ItemThumbBody };

async function fetchThumbnails(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const results = await mlFetch<MultigetResult[]>(
          `/items?ids=${chunk.join(',')}&attributes=id,thumbnail,secure_thumbnail`,
        );
        results.forEach((r) => {
          if (r.code === 200 && r.body) {
            map.set(r.body.id, r.body.secure_thumbnail || r.body.thumbnail || '');
          }
        });
      } catch {
        // los thumbnails son "nice to have": si falla un lote, seguimos sin esas fotos
      }
    }),
  );
  return map;
}

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

    const map = new Map<string, { id: string; title: string; qty: number; revenue: number }>();
    valid.forEach((o) => {
      o.order_items.forEach((it) => {
        const key = it.item.id;
        const row = map.get(key) ?? { id: key, title: it.item.title, qty: 0, revenue: 0 };
        row.qty += it.quantity;
        row.revenue += it.quantity * it.unit_price;
        map.set(key, row);
      });
    });

    const sorted = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const thumbs = await fetchThumbnails(sorted.map((p) => p.id));
    const products = sorted.map((p) => ({ ...p, thumbnail: thumbs.get(p.id) || null }));

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
