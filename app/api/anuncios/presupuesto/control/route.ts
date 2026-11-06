import { ajustar } from '@/lib/ajustePresupuesto';

export const maxDuration = 120;

// Lo llama el servidor DonWeb todos los días a las 10:00 (?dry=1 = solo simula). Si ya corrió hoy, no repite.
export async function POST(req: Request) {
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const r = await ajustar(dry);
    return Response.json({ ok: true, dry, ...r });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
