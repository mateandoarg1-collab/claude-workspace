import { fetchOrdersInRange, isValidOrder } from '@/lib/ml';
import { desdeAR, inicioAR } from '@/lib/periodo';
import { getEmpretiendaDiario, getMayoristaDiario } from '@/lib/sheets';
import { getShopifyDiario } from '@/lib/shopify';

export const maxDuration = 30;

type Dia = { ventas: number; monto: number };
const diaAR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 10);

// Ventas (pedidos) y facturación por día del mes en curso de un canal (?canal=online|ml|local|shopify|mayorista),
// con el mismo criterio que la tabla de /canales.
export async function GET(req: Request) {
  try {
    const canal = new URL(req.url).searchParams.get('canal');
    const desde = desdeAR('mes');
    const hoy = desdeAR('hoy');
    let dias = new Map<string, Dia>();

    if (canal === 'ml') {
      const orders = (await fetchOrdersInRange(inicioAR(desde), new Date())).filter(isValidOrder);
      const packs = new Map<string, Set<number>>();
      for (const o of orders) {
        const d = diaAR(o.date_created);
        const x = dias.get(d) ?? { ventas: 0, monto: 0 };
        x.monto += o.total_amount || 0;
        dias.set(d, x);
        packs.set(d, (packs.get(d) ?? new Set()).add(o.pack_id ?? o.id));
      }
      for (const [d, s] of packs) dias.get(d)!.ventas = s.size;
    } else if (canal === 'shopify') {
      dias = await getShopifyDiario(desde);
    } else if (canal === 'mayorista') {
      dias = await getMayoristaDiario(desde);
    } else if (canal === 'online' || canal === 'local') {
      for (const r of await getEmpretiendaDiario()) {
        dias.set(r.dia, canal === 'local'
          ? { ventas: r.acordarCant, monto: r.acordarMonto }
          : { ventas: r.totalCant - r.acordarCant, monto: r.totalMonto - r.acordarMonto });
      }
    } else {
      return Response.json({ error: 'canal inválido' }, { status: 400 });
    }

    // Todos los días del mes hasta hoy; null = sin dato (Empretienda todavía no lo leyó).
    const out: Array<{ dia: string; ventas: number | null; monto: number | null }> = [];
    for (let d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hoy; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      const v = dias.get(k);
      const sinDato = !v && (canal === 'online' || canal === 'local');
      out.push({ dia: k, ventas: sinDato ? null : (v?.ventas ?? 0), monto: sinDato ? null : Math.round(v?.monto ?? 0) });
    }
    return Response.json({ canal, dias: out });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
