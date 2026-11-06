import { ajustar, guardarConfig, historial } from '@/lib/ajustePresupuesto';

export const maxDuration = 60;

// GET → config, qué haría hoy cada campaña con lo de ayer (simulación) e historial.
export async function GET() {
  try {
    const [previa, hist] = await Promise.all([ajustar(true), historial()]);
    return Response.json({ ...previa, historial: hist });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST { config: {subirRoas, subirCpa, bajarCpa, paso} | null } → guarda (null = apagar).
// POST { ajustarAhora: true } → corre el ajuste ya (aunque hoy ya haya corrido).
export async function POST(req: Request) {
  const b = (await req.json()) as { config?: { subirRoas: number; subirCpa: number; bajarCpa: number; paso: number } | null; ajustarAhora?: boolean };
  try {
    if (b.ajustarAhora) return Response.json(await ajustar(false, true));
    const c = b.config;
    const ok = c && c.subirRoas > 0 && c.subirCpa > 0 && c.bajarCpa > 0 && c.subirCpa <= c.bajarCpa && c.paso > 0 && c.paso <= 50;
    if (c && !ok) return Response.json({ error: 'Valores inválidos' }, { status: 400 });
    await guardarConfig(c ? { subirRoas: Number(c.subirRoas), subirCpa: Math.round(Number(c.subirCpa)), bajarCpa: Math.round(Number(c.bajarCpa)), paso: Number(c.paso) } : null);
    return Response.json({ ok: true, config: c ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
