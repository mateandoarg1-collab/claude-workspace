import { getShopifyMonth } from '@/lib/shopify';

export async function GET() {
  try {
    return Response.json(await getShopifyMonth());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
