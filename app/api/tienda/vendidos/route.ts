import { conCache } from '@/lib/cache';
import { getRentabilidadTienda } from '@/lib/tienda';

// Productos vendidos en la tienda de Empretienda (pedido de Nacho, 27-nov-2026), como el panel de Métricas de
// Empretienda pero dentro de la app. Sale de rentabilidad_tienda (ventas pagas con sus productos, lo llena
// scripts/tienda-rentabilidad.mjs cada hora): no barre Empretienda. Volumen = cantidad × precio unitario (con IVA).
// Ganancia = neto de /rentabilidad-tienda (venta sin IVA − costo − packaging − comisiones − envío − impuestos), antes de pauta.
// ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&canal=todos|online|local

type Variante = { v: string; unidades: number; volumen: number };
type Fila = {
  id: string; producto: string; foto: string | null; link: string | null; unidades: number; volumen: number; pedidos: number; variantes: Variante[];
  ventaNeta: number; ganancia: number; sinCosto: boolean;
};

async function obtener(req: Request) {
  const sp = new URL(req.url).searchParams;
  const desde = sp.get('desde') ?? '';
  const hasta = sp.get('hasta') ?? desde;
  const canal = sp.get('canal') ?? 'todos';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return Response.json({ error: 'Fechas inválidas' }, { status: 400 });
  try {
    const { ventas, fotos, actualizado } = await getRentabilidadTienda();
    const filas = new Map<string, Fila & { _ped: Set<string>; _var: Map<string, Variante> }>();
    let pedidos = 0, unidades = 0, volumen = 0, ventaNeta = 0, ganancia = 0;
    for (const v of ventas) {
      if (v.fecha < desde || v.fecha > hasta) continue;
      if (canal !== 'todos' && v.canal !== canal) continue;
      pedidos++;
      ventaNeta += v.venta;
      ganancia += v.neto;
      // La venta sin IVA y la ganancia (neto, antes de pauta) de cada venta se reparten entre sus productos según el precio.
      const bruto = v.productos.reduce((s, p) => s + (Number(p.p) || 0) * (Number(p.q) || 0), 0) || 1;
      const faltan = new Set(v.sin_costo_productos.map((x) => x.toUpperCase().trim()));
      for (const p of v.productos) {
        const k = p.id || p.n;
        const vol = (Number(p.p) || 0) * (Number(p.q) || 0);
        const f = filas.get(k) ?? {
          id: p.id, producto: p.n, foto: fotos.get(p.id)?.foto ?? null, link: fotos.get(p.id)?.link ?? null,
          unidades: 0, volumen: 0, pedidos: 0, variantes: [], ventaNeta: 0, ganancia: 0, sinCosto: false, _ped: new Set<string>(), _var: new Map<string, Variante>(),
        };
        f.unidades += Number(p.q) || 0;
        f.volumen += vol;
        f.ventaNeta += v.venta * (vol / bruto);
        f.ganancia += v.neto * (vol / bruto);
        const nom = (p.n ?? '').toUpperCase().trim();
        if (nom && [...faltan].some((x) => x.includes(nom))) f.sinCosto = true;
        f._ped.add(v.order_id);
        const vk = (p.v ?? '').trim();
        const va = f._var.get(vk) ?? { v: vk, unidades: 0, volumen: 0 };
        va.unidades += Number(p.q) || 0;
        va.volumen += vol;
        f._var.set(vk, va);
        filas.set(k, f);
        unidades += Number(p.q) || 0;
        volumen += vol;
      }
    }
    const productos: Fila[] = [...filas.values()].map(({ _ped, _var, ...f }) => ({
      ...f, pedidos: _ped.size, variantes: [..._var.values()].sort((a, b) => b.unidades - a.unidades),
    }));
    return Response.json({ desde, hasta, canal, actualizado, pedidos, unidades, volumen, ventaNeta, ganancia, productos });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = conCache(obtener, 300);
