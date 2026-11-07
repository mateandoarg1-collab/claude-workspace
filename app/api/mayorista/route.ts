import { conCache } from '@/lib/cache';
import { getMayoristaPeriodo } from '@/lib/sheets';
import { parsePeriodo } from '@/lib/periodo';

async function obtener(req: Request) {
  try {
    return Response.json(await getMayoristaPeriodo(parsePeriodo(new URL(req.url).searchParams.get('periodo'))));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const GET = conCache(obtener, 300);
