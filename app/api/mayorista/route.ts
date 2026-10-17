import { getMayoristaPeriodo } from '@/lib/sheets';
import { parsePeriodo } from '@/lib/periodo';

export async function GET(req: Request) {
  try {
    return Response.json(await getMayoristaPeriodo(parsePeriodo(new URL(req.url).searchParams.get('periodo'))));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
