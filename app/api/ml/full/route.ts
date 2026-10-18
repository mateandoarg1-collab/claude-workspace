import { mlFetch, ML_USER_ID } from '@/lib/ml';

export const maxDuration = 60;

// Stock en Mercado Libre Full por publicación/variante + días de cobertura según
// el ritmo de venta de los últimos `dias` días. Misma lógica que scripts/full-stock.mjs
// (no se considera stock de depósito propio, solo Full).

type Item = {
  id: string;
  title: string;
  status: string;
  inventory_id?: string;
  thumbnail_id?: string;
  permalink: string;
  shipping?: { logistic_type?: string };
  variations?: Array<{ id: number; inventory_id?: string; picture_ids?: string[]; attribute_combinations?: Array<{ value_name: string }> }>;
};

const pic = (id?: string) => (id ? `https://http2.mlstatic.com/D_${id}-O.jpg` : '');

async function pool<T, R>(list: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < list.length) {
        const k = i++;
        out[k] = await fn(list[k]);
      }
    }),
  );
  return out;
}

export async function GET(req: Request) {
  try {
    const dias = Number(new URL(req.url).searchParams.get('dias')) || 30;
    const user = ML_USER_ID();

    // 1. Publicaciones activas + pausadas
    const ids: string[] = [];
    for (const status of ['active', 'paused']) {
      let scroll = '';
      for (;;) {
        const r = await mlFetch<{ results: string[]; scroll_id: string }>(
          `/users/${user}/items/search?status=${status}&search_type=scan&limit=100${scroll ? `&scroll_id=${scroll}` : ''}`,
        );
        if (!r.results.length) break;
        ids.push(...r.results);
        scroll = r.scroll_id;
      }
    }
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const items = (
      await pool(chunks, 5, (c) =>
        mlFetch<Array<{ body: Item }>>(
          `/items?ids=${c.join(',')}&attributes=id,title,status,inventory_id,shipping,variations,permalink,thumbnail_id`,
        ),
      )
    ).flat();

    const units: Array<{ item_id: string; variation_id: number | null; inventory_id: string; title: string; variant: string; status: string; permalink: string; thumbnail: string }> = [];
    for (const { body: it } of items) {
      if (it?.shipping?.logistic_type !== 'fulfillment') continue;
      if (it.variations?.length) {
        for (const v of it.variations) {
          if (!v.inventory_id) continue;
          units.push({
            item_id: it.id, variation_id: v.id, inventory_id: v.inventory_id, title: it.title,
            variant: (v.attribute_combinations ?? []).map((a) => a.value_name).join(' / '),
            status: it.status, permalink: it.permalink, thumbnail: pic(v.picture_ids?.[0] ?? it.thumbnail_id),
          });
        }
      } else if (it.inventory_id) {
        units.push({ item_id: it.id, variation_id: null, inventory_id: it.inventory_id, title: it.title, variant: '', status: it.status, permalink: it.permalink, thumbnail: pic(it.thumbnail_id) });
      }
    }

    // 2. Ventas de los últimos `dias` días por item/variante
    const from = new Date(Date.now() - dias * 864e5).toISOString().replace('Z', '-00:00');
    const sold = new Map<string, number>();
    type Orders = { results: Array<{ order_items: Array<{ quantity: number; item: { id: string; variation_id?: number } }> }>; paging: { total: number } };
    const q = (off: number) =>
      mlFetch<Orders>(`/orders/search?seller=${user}&order.status=paid&order.date_created.from=${encodeURIComponent(from)}&sort=date_desc&limit=50&offset=${off}`);
    const first = await q(0);
    const total = Math.min(first.paging.total, 10000);
    const rest = await pool(Array.from({ length: Math.ceil(total / 50) - 1 }, (_, k) => (k + 1) * 50), 8, q);
    for (const page of [first, ...rest]) {
      for (const o of page.results) {
        for (const oi of o.order_items) {
          const k = `${oi.item.id}|${oi.item.variation_id ?? ''}`;
          sold.set(k, (sold.get(k) ?? 0) + oi.quantity);
        }
      }
    }

    // 3. Stock en Full + cobertura
    const rows = await pool(units, 10, async (u) => {
      const s = await mlFetch<{ available_quantity?: number; not_available_detail?: Array<{ status: string; quantity: number }> }>(
        `/inventories/${u.inventory_id}/stock/fulfillment`,
      ).catch(() => null);
      const vendidas = sold.get(`${u.item_id}|${u.variation_id ?? ''}`) ?? 0;
      const stock = s?.available_quantity ?? 0;
      const porDia = vendidas / dias;
      return {
        ...u,
        stock,
        no_disponible: (s?.not_available_detail ?? []).reduce((a, d) => a + d.quantity, 0),
        vendidas,
        por_dia: porDia,
        dias_stock: porDia > 0 ? stock / porDia : null, // null = sin ventas
      };
    });

    return Response.json({ dias, actualizado: new Date().toISOString(), rows });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
