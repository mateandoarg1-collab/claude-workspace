import { getEmpretiendaManual, setEmpretiendaManual } from '@/lib/sheets';

export async function GET() {
  try {
    const data = await getEmpretiendaManual();
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = await setEmpretiendaManual({
      totalMonto: Number(body.totalMonto) || 0,
      totalCant: Number(body.totalCant) || 0,
      localMonto: Number(body.localMonto) || 0,
      localCant: Number(body.localCant) || 0,
    });
    return Response.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
