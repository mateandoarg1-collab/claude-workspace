import { getClarityInsights } from '@/lib/clarity';

export async function GET(req: Request) {
  try {
    const days = Number(new URL(req.url).searchParams.get('days') ?? '3');
    const clamped = Math.min(3, Math.max(1, days)) as 1 | 2 | 3;
    const data = await getClarityInsights(clamped);
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
