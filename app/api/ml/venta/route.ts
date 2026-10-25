import { getVentaMeli } from '@/lib/sheets';
import { fetchThumbnails, mlFetch } from '@/lib/ml';
import { getCostosAdicionales } from '@/lib/costosMeli';

export const maxDuration = 30;

const IVA = 1.21;

type OrdenML = {
  id: number; date_created: string; status: string; tags?: string[];
  order_items: Array<{
    item: { id: string; title: string; variation_id?: number | null; variation_attributes?: Array<{ value_name: string | null }> };
    quantity: number; unit_price: number; full_unit_price?: number | null;
  }>;
};
type EnvioML = {
  status?: string; substatus?: string | null; logistic?: { type?: string };
  destination?: { shipping_address?: { city?: { name?: string }; state?: { name?: string } } };
};

// Detalle de una venta (?id=número de orden o de carrito): el cálculo de la planilla rentabilidad_meli más lo que
// muestra ML de la orden (hora, productos, precio de lista) y del envío (estado, destino).
export async function GET(req: Request) {
  try {
    const id = (new URL(req.url).searchParams.get('id') ?? '').replace(/\D/g, '');
    if (!id) return Response.json({ error: 'Falta el número de venta' }, { status: 400 });
    const { ordenes } = await getVentaMeli(id);
    if (!ordenes.length) {
      return Response.json({ error: 'No encontré esa venta. Las ventas nuevas aparecen en la próxima actualización (cada hora).' }, { status: 404 });
    }

    const envios = [...new Set(ordenes.map((o) => o.envio_id).filter(Boolean))];
    const [ml, envioML, fotos, adicionales] = await Promise.all([
      Promise.all(ordenes.map((o) => mlFetch<OrdenML>(`/orders/${o.order_id}`).catch(() => null))),
      envios.length ? mlFetch<EnvioML>(`/shipments/${envios[0]}`, { headers: { 'x-format-new': 'true' } }).catch(() => null) : null,
      fetchThumbnails([...new Set(ordenes.map((o) => o.item_id))]),
      getCostosAdicionales(),
    ]);

    const filas = ordenes.map((o, i) => {
      const m = ml[i];
      return {
        ...o,
        creada: m?.date_created ?? o.creada,
        estadoML: m?.status ?? null,
        productos: (m?.order_items ?? []).map((oi) => ({
          item_id: oi.item.id,
          titulo: oi.item.title,
          variante: (oi.item.variation_attributes ?? []).map((a) => a.value_name).filter(Boolean).join(' / ') || null,
          cantidad: oi.quantity,
          precio: oi.unit_price / IVA,
          precioLista: oi.full_unit_price && oi.full_unit_price > oi.unit_price ? oi.full_unit_price / IVA : null,
          foto: fotos.get(oi.item.id) ?? null,
        })),
      };
    });

    // Costos adicionales variables que le tocan a esta venta (informativo: la ganancia final los resta en el total).
    // El de "venta con IVA − publicidad" se muestra sin descontar publicidad, que no se reparte por venta.
    const venta = ordenes.reduce((s, o) => s + o.venta, 0);
    const fecha = ordenes[0].fecha;
    const otros = adicionales
      .filter((c) => c.tipo === 'variable' && (!c.desde || fecha >= c.desde) && (!c.hasta || fecha <= c.hasta))
      .map((c) => ({
        nombre: c.nombre,
        detalle: c.base === 'pedido' ? `$${c.monto.toLocaleString('es-AR')} por venta` : `${c.monto.toLocaleString('es-AR')}% de ${c.base === 'venta' ? 'la venta sin IVA' : 'la venta con IVA (antes de publicidad)'}`,
        monto: c.base === 'pedido' ? c.monto : ((c.base === 'venta' ? venta : venta * IVA) * c.monto) / 100,
      }));

    const destino = envioML?.destination?.shipping_address;
    return Response.json({
      id,
      pack_id: ordenes[0].pack_id || null,
      ordenes: filas,
      envio: envioML && {
        estado: envioML.status ?? null,
        subestado: envioML.substatus ?? null,
        ciudad: destino?.city?.name ?? null,
        provincia: destino?.state?.name ?? null,
      },
      otros,
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
