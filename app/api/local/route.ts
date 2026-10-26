import { addLocalVenta, getLocalVentasEntre, getLocalVentasSummary } from '@/lib/localVentas';

// Cobro del local del mes en curso, o entre ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD.
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    if (dia.test(q.get('desde') ?? '') && dia.test(q.get('hasta') ?? '')) {
      return Response.json(await getLocalVentasEntre(q.get('desde')!, q.get('hasta')!));
    }
    const ar = new Date(Date.now() - 3 * 3600 * 1000);
    const data = await getLocalVentasSummary(ar.getUTCFullYear(), ar.getUTCMonth() + 1);
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const monto = Number(body.monto);
    const metodo = body.metodo === 'transferencia' ? 'transferencia' : 'efectivo';
    if (!monto || monto <= 0) {
      return Response.json({ error: 'Monto inválido' }, { status: 400 });
    }
    await addLocalVenta(monto, metodo);
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
