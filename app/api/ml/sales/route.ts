import { mlFetch, ML_USER_ID } from '@/lib/ml';

type Order = {
  id: number;
  status: string;
  date_created: string;
  total_amount: number;
  order_items: Array<{
    item: { id: string; title: string };
    quantity: number;
    unit_price: number;
  }>;
};

type Search = { results: Order[]; paging: { total: number } };

async function fetchOrders(from: string, to: string): Promise<Order[]> {
  const out: Order[] = [];
  let offset = 0;
  while (true) {
    const q = new URLSearchParams({
      seller: ML_USER_ID(),
      'order.date_created.from': from,
      'order.date_created.to': to,
      sort: 'date_desc',
      limit: '50',
      offset: String(offset),
    });
    const data = await mlFetch<Search>(`/orders/search?${q}`);
    out.push(...data.results);
    if (data.results.length < 50) break;
    offset += 50;
    if (offset > 5000) break; // safety
  }
  return out;
}

function isValid(o: Order) {
  return o.status === 'paid' || o.status === 'confirmed';
}

function fmtTZ(d: Date) {
  return d.toISOString().replace('Z', '-00:00');
}

function summarize(orders: Order[]) {
  const valid = orders.filter(isValid);
  return {
    orders: valid.length,
    amount: valid.reduce((s, o) => s + (o.total_amount || 0), 0),
    units: valid.reduce(
      (s, o) => s + o.order_items.reduce((sx, it) => sx + (it.quantity || 0), 0),
      0,
    ),
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };
}

export async function GET() {
  const now = new Date();
  // Hora AR = UTC - 3. Día actual en AR = (now - 3h) en UTC.
  const arNow = new Date(now.getTime() - 3 * 3600 * 1000);
  const arYear = arNow.getUTCFullYear();
  const arMonth = arNow.getUTCMonth();
  const arDay = arNow.getUTCDate();
  // Medianoche AR del día de hoy expresada en UTC = ese día AR 00:00 + 3h = 03:00 UTC.
  const todayStart = new Date(Date.UTC(arYear, arMonth, arDay, 3, 0, 0));
  const yestStart = new Date(todayStart);
  yestStart.setUTCDate(yestStart.getUTCDate() - 1);
  const elapsedMs = now.getTime() - todayStart.getTime();
  const yestSameHour = new Date(yestStart.getTime() + elapsedMs);
  const yestEnd = new Date(todayStart.getTime() - 1000);

  const monthStart = new Date(Date.UTC(arYear, arMonth, 1, 3, 0, 0));
  const sevenDaysAgo = new Date(todayStart.getTime() - 7 * 24 * 3600 * 1000);

  try {
    const [today, yestSame, yestFull, last7, monthOrders] = await Promise.all([
      fetchOrders(fmtTZ(todayStart), fmtTZ(now)),
      fetchOrders(fmtTZ(yestStart), fmtTZ(yestSameHour)),
      fetchOrders(fmtTZ(yestStart), fmtTZ(yestEnd)),
      fetchOrders(fmtTZ(sevenDaysAgo), fmtTZ(todayStart)),
      fetchOrders(fmtTZ(monthStart), fmtTZ(now)),
    ]);

    const todayS = summarize(today);
    const monthS = summarize(monthOrders);

    // Top productos de hoy
    const prodMap = new Map<string, { qty: number; revenue: number; id: string }>();
    today.filter(isValid).forEach((o) => {
      o.order_items.forEach((it) => {
        const key = it.item.title;
        const e = prodMap.get(key) ?? { qty: 0, revenue: 0, id: it.item.id };
        e.qty += it.quantity;
        e.revenue += it.quantity * it.unit_price;
        prodMap.set(key, e);
      });
    });
    const topToday = Array.from(prodMap.entries())
      .map(([title, v]) => ({ title, ...v }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    return Response.json({
      generated_at: now.toISOString(),
      today: {
        ...todayS,
        elapsed_hours: (now.getTime() - todayStart.getTime()) / 3.6e6,
      },
      yesterday_same_hour: summarize(yestSame),
      yesterday_full: summarize(yestFull),
      last_7_days: summarize(last7),
      month_to_date: monthS,
      top_products_today: topToday,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
