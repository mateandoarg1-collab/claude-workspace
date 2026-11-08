import { getEscaneos, registrar } from '@/lib/despacho';

export const maxDuration = 30;

// POST { codigo, quien } → registra la etiqueta como embalada. GET → escaneos de hoy (hora AR).
export async function POST(req: Request) {
  try {
    const { codigo, quien } = await req.json();
    return Response.json(await registrar(String(codigo ?? ''), String(quien ?? '').slice(0, 40)));
  } catch (e: unknown) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    const todos = await getEscaneos();
    const deHoy = todos.filter((e) => new Date(Date.parse(e.fecha) - 3 * 3600e3).toISOString().slice(0, 10) === hoy);
    return Response.json({ hoy: deHoy.reverse() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
