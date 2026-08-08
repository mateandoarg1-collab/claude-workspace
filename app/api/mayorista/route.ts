import { getMayoristaSummary } from '@/lib/sheets';

export async function GET() {
  try {
    const data = await getMayoristaSummary();
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
