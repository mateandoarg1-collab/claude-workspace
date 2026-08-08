import { getMercadoPagoSummary } from '@/lib/mercadopago';

function monthToDateRange() {
  const now = new Date();
  const arNow = new Date(now.getTime() - 3 * 3600 * 1000);
  const y = arNow.getUTCFullYear();
  const m = arNow.getUTCMonth();
  const monthStart = new Date(Date.UTC(y, m, 1, 3, 0, 0));
  return { from: monthStart.toISOString(), to: now.toISOString() };
}

export async function GET() {
  try {
    const { from, to } = monthToDateRange();
    const data = await getMercadoPagoSummary(from, to);
    return Response.json({ month_to_date: data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
