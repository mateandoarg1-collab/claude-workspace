import { mlFetch, ML_USER_ID } from '@/lib/ml';

export async function GET() {
  try {
    const data = await mlFetch<{ total: number }>(
      `/questions/search?seller_id=${ML_USER_ID()}&status=UNANSWERED&limit=1`,
    );
    return Response.json({ count: data.total });
  } catch {
    return Response.json({ count: 0 });
  }
}
