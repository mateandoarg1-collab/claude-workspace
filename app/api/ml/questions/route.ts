import { mlFetch, ML_USER_ID } from '@/lib/ml';

type Question = {
  id: number;
  text: string;
  status: string;
  date_created: string;
  item_id: string;
  from?: { id: number };
};

type Item = { id: string; title: string; price: number; permalink: string };

export async function GET() {
  try {
    const data = await mlFetch<{ questions: Question[]; total: number }>(
      `/questions/search?seller_id=${ML_USER_ID()}&status=UNANSWERED&limit=50&sort_fields=date_created&sort_types=DESC`,
    );

    // Enriquecer con datos del item
    const uniqueItems = Array.from(new Set(data.questions.map((q) => q.item_id)));
    const itemMap = new Map<string, Item>();
    await Promise.all(
      uniqueItems.map(async (id) => {
        try {
          const it = await mlFetch<Item>(`/items/${id}?attributes=id,title,price,permalink`);
          itemMap.set(id, it);
        } catch {
          /* ignore */
        }
      }),
    );

    const enriched = data.questions.map((q) => {
      const it = itemMap.get(q.item_id);
      return {
        id: q.id,
        text: q.text,
        date_created: q.date_created,
        item_id: q.item_id,
        item_title: it?.title ?? '(producto no encontrado)',
        item_price: it?.price ?? 0,
        item_permalink: it?.permalink ?? '',
      };
    });

    return Response.json({ total: data.total, questions: enriched });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
