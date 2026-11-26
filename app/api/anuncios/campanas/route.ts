import { tokenPara } from '@/lib/anuncios';
import { campanasActivas, controlarCampanas, guardarCpaCampana } from '@/lib/cpaCampanas';

export const maxDuration = 60;

// GET ?cuenta=act_… → campañas activas con gasto/ventas de 7 días, CPA máx y vista previa de qué se apagaría.
export async function GET(req: Request) {
  const cuenta = new URL(req.url).searchParams.get('cuenta') ?? '';
  if (!cuenta || !tokenPara(cuenta)) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    return Response.json({ campanas: await campanasActivas(cuenta) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST { cuenta, campana, nombre, cpaMax } — cpaMax vacío/0 = sacar el control de esa campaña.
// POST { cuenta, apagarAhora: true } — corre el control por campaña ya mismo en esa cuenta.
export async function POST(req: Request) {
  const b = (await req.json()) as { cuenta: string; campana?: string; nombre?: string; cpaMax?: number | null; apagarAhora?: boolean };
  if (!b.cuenta || !tokenPara(b.cuenta)) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    if (b.apagarAhora) return Response.json({ ok: true, ...(await controlarCampanas(b.cuenta, false)) });
    if (!b.campana) return Response.json({ error: 'Falta la campaña' }, { status: 400 });
    const valor = b.cpaMax ? Math.round(Number(b.cpaMax)) : null;
    await guardarCpaCampana(b.cuenta, b.campana, b.nombre ?? '', valor);
    return Response.json({ ok: true, cpaMax: valor });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
