import { conCache } from '@/lib/cache';
import { getShopifyCmv, getShopifyVentas } from '@/lib/shopify';
import { parsePeriodo } from '@/lib/periodo';

async function obtener(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const [ventas, cmv] = await Promise.all([getShopifyVentas(periodo), getShopifyCmv(periodo).catch((e) => ({ error: String(e) }))]);
    return Response.json({ ...ventas, cmv });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export const GET = conCache(obtener, 120);
