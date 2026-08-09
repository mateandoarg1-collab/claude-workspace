import { fetchSnapshot, appendSnapshot } from '@/lib/competencia';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const { rows, errors } = await fetchSnapshot();
    await appendSnapshot(rows);
    return Response.json({ ok: true, checked_at: new Date().toISOString(), rows, errors });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
