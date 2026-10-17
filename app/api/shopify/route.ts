import { getShopifyVentas } from '@/lib/shopify';
import { parsePeriodo } from '@/lib/periodo';

export async function GET(req: Request) {
  try {
    return Response.json(await getShopifyVentas(parsePeriodo(new URL(req.url).searchParams.get('periodo'))));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
