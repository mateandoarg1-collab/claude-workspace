import { mlFetch, ML_USER_ID } from '@/lib/ml';

type Question = {
  id: number;
  text: string;
  status: string;
  date_created: string;
  item_id: string;
  answer?: { text: string; date_created: string };
};

type QuestionSearch = { questions: Question[]; total: number };

type ItemBody = {
  id: string;
  title: string;
  price: number;
  permalink: string;
  available_quantity: number;
  thumbnail?: string;
  secure_thumbnail?: string;
};
type MultigetResult = { code: number; body: ItemBody };

async function fetchItems(ids: string[]): Promise<Map<string, ItemBody>> {
  const map = new Map<string, ItemBody>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const results = await mlFetch<MultigetResult[]>(
          `/items?ids=${chunk.join(',')}&attributes=id,title,price,permalink,available_quantity,thumbnail,secure_thumbnail`,
        );
        results.forEach((r) => {
          if (r.code === 200 && r.body) map.set(r.body.id, r.body);
        });
      } catch {
        // producto no encontrado: seguimos sin sus datos
      }
    }),
  );
  return map;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = url.searchParams.get('status') === 'answered' ? 'ANSWERED' : 'UNANSWERED';
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const limit = 30;

    const data = await mlFetch<QuestionSearch>(
      `/questions/search?seller_id=${ML_USER_ID()}&status=${status}&limit=${limit}&offset=${offset}&sort_fields=date_created&sort_types=DESC`,
    );

    const uniqueItemIds = Array.from(new Set(data.questions.map((q) => q.item_id)));
    const itemMap = await fetchItems(uniqueItemIds);

    type GroupedQuestion = {
      id: number;
      text: string;
      date_created: string;
      answer: { text: string; date_created: string } | null;
    };
    type Group = {
      item_id: string;
      item_title: string;
      item_price: number;
      item_permalink: string;
      item_thumbnail: string | null;
      item_stock: number;
      questions: GroupedQuestion[];
    };

    const groups = new Map<string, Group>();
    data.questions.forEach((q) => {
      let g = groups.get(q.item_id);
      if (!g) {
        const it = itemMap.get(q.item_id);
        const thumb = it?.secure_thumbnail || it?.thumbnail || null;
        g = {
          item_id: q.item_id,
          item_title: it?.title ?? '(producto no encontrado)',
          item_price: it?.price ?? 0,
          item_permalink: it?.permalink ?? '',
          item_thumbnail: thumb ? thumb.replace(/^http:\/\//, 'https://') : null,
          item_stock: it?.available_quantity ?? 0,
          questions: [],
        };
        groups.set(q.item_id, g);
      }
      g.questions.push({
        id: q.id,
        text: q.text,
        date_created: q.date_created,
        answer: q.answer ? { text: q.answer.text, date_created: q.answer.date_created } : null,
      });
    });

    return Response.json({
      total: data.total,
      has_more: offset + data.questions.length < data.total,
      next_offset: offset + limit,
      groups: Array.from(groups.values()),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
