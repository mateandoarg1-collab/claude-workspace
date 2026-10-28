import { getCostosAdicionales } from '@/lib/costosMeli';
import { getCostosTienda, getSinCostoTienda, setCostoTienda } from '@/lib/costosTienda';

export const maxDuration = 30;

// Costos de la tienda para /rentabilidad-tienda/costos: productos sin costo, costos cargados a mano y costos adicionales.
export async function GET() {
  try {
    const [manuales, adicionales] = await Promise.all([getCostosTienda(), getCostosAdicionales()]);
    return Response.json({ sinCosto: await getSinCostoTienda(manuales), manuales, adicionales });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST { producto, costo } → costo a mano de un producto (costo null lo borra y vuelve a las reglas).
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const producto = String(b.producto ?? '').trim().slice(0, 200);
    const costo = b.costo == null ? null : Number(b.costo);
    if (!producto || (costo != null && !(costo >= 0))) return Response.json({ error: 'Datos inválidos' }, { status: 400 });
    return Response.json({ manuales: await setCostoTienda(producto, costo) });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
