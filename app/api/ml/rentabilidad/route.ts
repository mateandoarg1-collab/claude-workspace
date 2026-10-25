import { getRentabilidadMeli, type FilaRentaMeli } from '@/lib/sheets';
import { desdeAR, hastaAR } from '@/lib/periodo';

export const maxDuration = 30;

// Costos fuera de la orden, como estaban en Escalafy: Pichón 2% de la venta sin IVA (pauta, desde oct-2026)
// y Nubimetrics $101.035 por mes repartidos por día.
const PICHON = { desde: '2026-10-01', tasa: 0.02 };
const NUBIMETRICS_DIA = 101035 / 30;

// ?periodo=hoy|ayer|semana|mes|mesant (mes anterior completo)
function rango(p: string | null): [string, string] {
  if (p === 'hoy' || p === 'ayer' || p === 'semana') return [desdeAR(p), hastaAR(p)];
  const inicio = desdeAR('mes');
  if (p !== 'mesant') return [inicio, hastaAR('mes')];
  const fin = new Date(`${inicio}T12:00:00Z`);
  fin.setUTCDate(0);
  return [fin.toISOString().slice(0, 8) + '01', fin.toISOString().slice(0, 10)];
}

const CAMPOS = ['venta', 'comision', 'envio_ml', 'envio_flex', 'impuestos', 'costo', 'neto'] as const;
type Totales = Record<(typeof CAMPOS)[number], number> & { ordenes: number; unidades: number };

function sumar(filas: FilaRentaMeli[]): Totales {
  const t = Object.fromEntries(CAMPOS.map((k) => [k, 0])) as Totales;
  for (const f of filas) for (const k of CAMPOS) t[k] += f[k];
  // Las canceladas después de despachar suman sus costos pero no son pedidos ni unidades vendidas.
  const vendidas = filas.filter((f) => !f.anulada);
  t.ordenes = new Set(vendidas.map((f) => f.pack_id || f.order_id)).size;
  t.unidades = vendidas.reduce((s, f) => s + f.unidades, 0);
  return t;
}

// Pauta y costos fuera de la orden de un conjunto de días. `ganancia` es la de Escalafy (neto − ML Ads): ahí Pichón
// cuenta como publicidad general y Nubimetrics como costo fijo de la empresa, no del canal. `gananciaFinal` los resta.
function debajo(t: Totales, fechas: string[], pauta: number) {
  const pichon = fechas.every((f) => f >= PICHON.desde) ? t.venta * PICHON.tasa : 0;
  const nubimetrics = fechas.length * NUBIMETRICS_DIA;
  return { pauta, pichon, nubimetrics, ganancia: t.neto - pauta, gananciaFinal: t.neto - pauta - pichon - nubimetrics };
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD para un rango a medida (p. ej. para comparar contra otra fuente)
    const [desde, hasta] = dia.test(q.get('desde') ?? '') && dia.test(q.get('hasta') ?? '') ? [q.get('desde')!, q.get('hasta')!] : rango(q.get('periodo'));
    const { actualizado, ordenes, ads } = await getRentabilidadMeli(desde, hasta);

    const fechas: string[] = [];
    for (const d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) fechas.push(d.toISOString().slice(0, 10));
    const pautaDia = new Map(ads.map((a) => [a.fecha, a]));

    const dias = fechas.map((fecha) => {
      const t = sumar(ordenes.filter((o) => o.fecha === fecha));
      return { fecha, ...t, ...debajo(t, [fecha], pautaDia.get(fecha)?.gasto ?? 0) };
    });
    const total = sumar(ordenes);
    const pauta = ads.reduce((s, a) => s + a.gasto, 0);
    const atribuidas = ads.reduce((s, a) => s + a.atribuidas, 0);
    // Pichón se calcula por día (arranca el 1-oct): se suma lo de cada día.
    const pichon = dias.reduce((s, d) => s + d.pichon, 0);
    const nubimetrics = fechas.length * NUBIMETRICS_DIA;

    const porItem = new Map<string, FilaRentaMeli[]>();
    for (const o of ordenes) porItem.set(o.item_id, [...(porItem.get(o.item_id) ?? []), o]);
    const productos = [...porItem.entries()]
      .map(([item_id, fs]) => ({ item_id, titulo: fs[0].titulo, sinCosto: fs.some((f) => f.sin_costo > 0), ...sumar(fs) }))
      .sort((a, b) => b.venta - a.venta);

    const porLogistica = new Map<string, FilaRentaMeli[]>();
    for (const o of ordenes) porLogistica.set(o.logistica, [...(porLogistica.get(o.logistica) ?? []), o]);
    const logisticas = [...porLogistica.entries()]
      .map(([logistica, fs]) => ({ logistica, ...sumar(fs) }))
      .sort((a, b) => b.venta - a.venta);

    return Response.json({
      desde,
      hasta,
      actualizado,
      total: {
        ...total,
        pauta,
        atribuidas,
        pichon,
        nubimetrics,
        ganancia: total.neto - pauta,
        gananciaFinal: total.neto - pauta - pichon - nubimetrics,
        sinCosto: ordenes.reduce((s, o) => s + o.sin_costo, 0),
        flexEstimados: ordenes.filter((o) => o.flex_estimado).length,
      },
      dias: dias.filter((d) => d.ordenes || d.pauta).reverse(),
      productos,
      logisticas,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
