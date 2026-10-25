import { getCostosAdicionales, getPublicaciones, setCostoPublicacion, setCostosAdicionales, type CostoAdicional } from '@/lib/costosMeli';

export const maxDuration = 30;

// Costos de Mercado Libre para /rentabilidad-meli/costos: costo de producto por publicación y costos adicionales.
export async function GET() {
  try {
    const [publicaciones, adicionales] = await Promise.all([getPublicaciones(), getCostosAdicionales()]);
    return Response.json({ publicaciones, adicionales });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// POST { item_id, variant_id, costo, desde: 'siempre' | 'YYYY-MM-DD', nombre } → costo de una publicación
// PUT  { adicionales: CostoAdicional[] } → reemplaza la lista de costos adicionales
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const costo = Number(b.costo);
    if (!/^MLA\d+$/.test(String(b.item_id)) || !(costo >= 0) || !(b.desde === 'siempre' || FECHA.test(String(b.desde)))) {
      return Response.json({ error: 'Datos inválidos' }, { status: 400 });
    }
    const r = await setCostoPublicacion({
      item_id: String(b.item_id),
      variant_id: b.variant_id ? String(b.variant_id) : null,
      costo,
      desde: String(b.desde),
      nombre: String(b.nombre ?? '').slice(0, 200),
    });
    return Response.json(r);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const b = await req.json();
    if (!Array.isArray(b.adicionales)) return Response.json({ error: 'Datos inválidos' }, { status: 400 });
    const lista: CostoAdicional[] = b.adicionales
      .map((c: Record<string, unknown>) => ({
        nombre: String(c.nombre ?? '').trim().slice(0, 80),
        tipo: c.tipo === 'variable' ? 'variable' : 'fijo',
        monto: Number(c.monto) || 0,
        base: c.tipo === 'variable' && ['venta', 'venta_con_iva_menos_ads', 'pedido'].includes(String(c.base)) ? c.base : c.tipo === 'variable' ? 'venta' : '',
        desde: FECHA.test(String(c.desde)) ? String(c.desde) : '',
        hasta: FECHA.test(String(c.hasta)) ? String(c.hasta) : '',
      }))
      .filter((c: CostoAdicional) => c.nombre);
    await setCostosAdicionales(lista);
    return Response.json({ adicionales: lista });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
