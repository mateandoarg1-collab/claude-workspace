import { getHistorico } from '@/lib/historico';

// Histórico de ventas por mes y canal (pestaña historico_mensual).
export async function GET() {
  try {
    return Response.json({ filas: await getHistorico() });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
