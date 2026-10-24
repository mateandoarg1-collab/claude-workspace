import { getChina } from '@/lib/china';

export const maxDuration = 60;

// Productos chinos: ventas por canal desde el 1/9 y stock en vivo (ver lib/china.ts).
export async function GET() {
  try {
    return Response.json(await getChina());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
