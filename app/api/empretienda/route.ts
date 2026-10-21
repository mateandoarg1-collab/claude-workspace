import { getEmpretiendaCmv, getEmpretiendaManual, getEmpretiendaMetricas, setEmpretiendaManual } from '@/lib/sheets';

export async function GET() {
  try {
    const [data, metricas, cmv] = await Promise.all([getEmpretiendaManual(), getEmpretiendaMetricas(), getEmpretiendaCmv()]);
    return Response.json({ ...data, metricas, cmv });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = await setEmpretiendaManual({
      gocuotasMonto: Number(body.gocuotasMonto) || 0,
      gocuotasCant: Number(body.gocuotasCant) || 0,
    });
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
