import { addLocalVenta, getLocalVentasSummary } from '@/lib/localVentas';

export async function GET() {
  try {
    const now = new Date();
    const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const data = await getLocalVentasSummary(prefix);
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
