import { tokenPara } from '@/lib/anuncios';
import { controlar, guardarCpaMax, leerCpaMax, listarApagados } from '@/lib/cpaMax';

export const maxDuration = 60;

// GET ?cuenta=act_… → CPA máx configurado, anuncios ya apagados y vista previa (qué se apagaría ahora).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const cuenta = sp.get('cuenta') ?? '';
  if (!cuenta || !tokenPara(cuenta)) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    // ?probar=15000 → solo simula qué se apagaría con ese CPA máx.
    const probar = Number(sp.get('probar')) || 0;
    if (probar) return Response.json({ seApagarian: (await controlar(cuenta, true, probar)).apagados });
    const [cpaMax, apagados, previa] = await Promise.all([leerCpaMax(cuenta), listarApagados(cuenta), controlar(cuenta, true)]);
    return Response.json({ cpaMax, apagados, seApagarian: previa.apagados, revisados: previa.revisados });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST { cuenta, cpaMax } — cpaMax vacío/0 = desactivar el apagado automático en esa cuenta.
export async function POST(req: Request) {
  const { cuenta, cpaMax } = (await req.json()) as { cuenta: string; cpaMax: number | null };
  if (!cuenta || !tokenPara(cuenta)) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    const valor = cpaMax ? Math.round(Number(cpaMax)) : null;
    await guardarCpaMax(cuenta, valor);
    // (Meta tarda unos segundos en reflejar las etiquetas: se devuelve lo guardado, no lo releído)
    return Response.json({ ok: true, cpaMax: valor });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
