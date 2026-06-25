import { mlFetch } from '@/lib/ml';

export async function POST(req: Request) {
  try {
    const { question_id, text } = await req.json();
    if (!question_id || !text) {
      return Response.json({ error: 'question_id y text requeridos' }, { status: 400 });
    }
    const result = await mlFetch(`/answers`, {
      method: 'POST',
      body: JSON.stringify({ question_id, text }),
    });
    return Response.json({ ok: true, result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
