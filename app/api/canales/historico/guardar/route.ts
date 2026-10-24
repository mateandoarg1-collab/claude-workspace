import { guardarMes } from '@/lib/historico';

export const maxDuration = 60;

// Guarda Mercado Libre, Shopify y Mayorista de un mes (?mes=YYYY-MM) en el histórico. Sin mes: el mes de "ayer" (hora
// AR), así el cron diario de las 00:30 cierra el mes anterior el día 1. Idempotente: recalcula y reemplaza.
export async function GET(req: Request) {
  try {
    const p = new URL(req.url).searchParams.get('mes');
    const ayer = new Date(Date.now() - 27 * 3600e3).toISOString().slice(0, 7);
    const mes = p && /^\d{4}-\d{2}$/.test(p) ? p : ayer;
    return Response.json({ mes, filas: await guardarMes(mes) });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
