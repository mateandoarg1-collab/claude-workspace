import { meta, tokenPara } from '@/lib/anuncios';

// Reglas automáticas de Meta de la cuenta (?cuenta=act_…).
export async function GET(req: Request) {
  const cuenta = new URL(req.url).searchParams.get('cuenta') ?? '';
  const token = tokenPara(cuenta);
  if (!cuenta || !token) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    const j = await meta(`${cuenta}/adrules_library?fields=name,status,evaluation_spec,execution_spec,schedule_spec&limit=100`, token);
    return Response.json({ reglas: j.data ?? [] });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
