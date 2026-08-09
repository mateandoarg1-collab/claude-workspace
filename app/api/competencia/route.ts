import { getHistory, loadConfig } from '@/lib/competencia';

export async function GET() {
  try {
    const [history, grupos] = await Promise.all([getHistory(), Promise.resolve(loadConfig())]);
    return Response.json({ grupos, history });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
