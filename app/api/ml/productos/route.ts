import { fetchOrdersInRange, isValidOrder, type MLOrder } from '@/lib/ml';

export const maxDuration = 30;

type Bucket = { qty: number; revenue: number };
type ProductRow = { id: string; title: string; day: Bucket; week: Bucket; month: Bucket; last30: Bucket };
type BucketKey = 'day' | 'week' | 'month' | 'last30';

function emptyBucket(): Bucket {
  return { qty: 0, revenue: 0 };
}

export async function GET() {
  try {
    const now = new Date();
    // Hora AR = UTC - 3.
    const arNow = new Date(now.getTime() - 3 * 3600 * 1000);
    const arYear = arNow.getUTCFullYear();
    const arMonth = arNow.getUTCMonth();
    const arDay = arNow.getUTCDate();
    const todayStart = new Date(Date.UTC(arYear, arMonth, arDay, 3, 0, 0));

    // Semana empieza el lunes.
    const dow = arNow.getUTCDay(); // 0 = domingo
    const daysSinceMonday = (dow + 6) % 7;
    const weekStart = new Date(todayStart.getTime() - daysSinceMonday * 24 * 3600 * 1000);

    const monthStart = new Date(Date.UTC(arYear, arMonth, 1, 3, 0, 0));
    const last30Start = new Date(todayStart.getTime() - 29 * 24 * 3600 * 1000);

    const fetchFrom = new Date(Math.min(monthStart.getTime(), last30Start.getTime()));

    const orders = await fetchOrdersInRange(fetchFrom, now);
    const valid = orders.filter(isValidOrder);

    const map = new Map<string, ProductRow>();

    function addOrder(o: MLOrder, bucket: BucketKey) {
      o.order_items.forEach((it) => {
        const key = it.item.id;
        let row = map.get(key);
        if (!row) {
          row = { id: key, title: it.item.title, day: emptyBucket(), week: emptyBucket(), month: emptyBucket(), last30: emptyBucket() };
          map.set(key, row);
        }
        row[bucket].qty += it.quantity;
        row[bucket].revenue += it.quantity * it.unit_price;
      });
    }

    valid.forEach((o) => {
      const d = new Date(o.date_created);
      if (d >= last30Start) addOrder(o, 'last30');
      if (d >= monthStart) addOrder(o, 'month');
      if (d >= weekStart) addOrder(o, 'week');
      if (d >= todayStart) addOrder(o, 'day');
    });

    const products = Array.from(map.values()).sort((a, b) => b.last30.revenue - a.last30.revenue);

    return Response.json({ generated_at: now.toISOString(), products });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
