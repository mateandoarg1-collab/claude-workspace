import { ajustar, guardarConfig, historial, leerConfig, presupuestosActivos, roasDelDia } from '@/lib/ajustePresupuesto';
import { desdeAR } from '@/lib/periodo';

export const maxDuration = 60;

// GET → config, ROAS de ayer, qué haría hoy (simulación), presupuestos activos e historial.
export async function GET() {
  try {
    const [config, previa, activos, hist] = await Promise.all([leerConfig(), ajustar(true), presupuestosActivos(), historial()]);
    return Response.json({ config, previa, activos: activos.map((a) => ({ ...a, diario: a.diario / 100 })), historial: hist });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST { config: {subirSi, bajarSi, paso} | null } → guarda (null = apagar).
// POST { ajustarAhora: true } → corre el ajuste ya (aunque hoy ya haya corrido).
// POST { probarDia: 'AAAA-MM-DD' } → ROAS de ese día (para chequear).
export async function POST(req: Request) {
  const b = (await req.json()) as { config?: { subirSi: number; bajarSi: number; paso: number } | null; ajustarAhora?: boolean; probarDia?: string };
  try {
    if (b.ajustarAhora) return Response.json(await ajustar(false, true));
    if (b.probarDia) return Response.json(await roasDelDia(b.probarDia || desdeAR('ayer')));
    const c = b.config;
    const ok = c && c.subirSi > 0 && c.bajarSi > 0 && c.paso > 0 && c.paso <= 50 && c.bajarSi <= c.subirSi;
    if (c && !ok) return Response.json({ error: 'Valores inválidos' }, { status: 400 });
    await guardarConfig(c ? { subirSi: Number(c.subirSi), bajarSi: Number(c.bajarSi), paso: Number(c.paso) } : null);
    return Response.json({ ok: true, config: c ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
