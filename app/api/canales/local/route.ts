import { conCache } from '@/lib/cache';
import { cajaPorDia, CORTE_CAJA } from '@/lib/localCajaPeriodo';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

export const dynamic = 'force-dynamic';

// Ventas de la caja del local en el período de /canales (?periodo=hoy|ayer|semana|mes), desde el 9-nov-2026.
async function obtener(req: Request) {
  try {
    const p = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const dias = await cajaPorDia(desdeAR(p), hastaAR(p));
    let monto = 0, orders = 0;
    for (const v of dias.values()) { monto += v.monto; orders += v.ventas; }
    return Response.json({ amount: monto, orders, corte: CORTE_CAJA });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = conCache(obtener, 120);
