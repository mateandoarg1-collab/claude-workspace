import { getRentabilidadMeli, type FilaRentaMeli } from '@/lib/sheets';
import { fetchThumbnails } from '@/lib/ml';
import { desdeAR, hastaAR } from '@/lib/periodo';

export const maxDuration = 30;

// Costos fuera de la orden: Pichón 2% de (venta concretada CON IVA − inversión en ML Ads), desde oct-2026
// (pedido de Juampi, 24-oct-2026), y Nubimetrics $101.035 por mes repartidos por día.
const PICHON = { desde: '2026-10-01', tasa: 0.02 };
const IVA = 1.21;
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
  // La venta ya viene neta de cancelaciones y reembolsos; se le vuelve a sumar el IVA.
  const pichon = fechas.every((f) => f >= PICHON.desde) ? (t.venta * IVA - pauta) * PICHON.tasa : 0;
  const nubimetrics = fechas.length * NUBIMETRICS_DIA;
  return { pauta, pichon, nubimetrics, ganancia: t.neto - pauta, gananciaFinal: t.neto - pauta - pichon - nubimetrics };
}

function listaDias(desde: string, hasta: string) {
  const out: string[] = [];
  for (const d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// Indicadores de publicidad. ROAS como Escalafy: ventas atribuidas a ML Ads sin IVA ÷ inversión. ACOS = inversión ÷
// ventas atribuidas y TACOS = inversión ÷ facturación total, también sin IVA. Los "Ml" son como los muestra el panel de
// ML Ads (ventas con IVA).
function ratios(venta: number, ganancia: number, pauta: number, atribuidas: number) {
  const atribSinIva = atribuidas / IVA;
  return {
    margen: venta ? ganancia / venta : null,
    roas: pauta ? atribSinIva / pauta : null,
    acos: atribSinIva ? pauta / atribSinIva : null,
    tacos: venta ? pauta / venta : null,
    roasMl: pauta ? atribuidas / pauta : null,
    acosMl: atribuidas ? pauta / atribuidas : null,
    tacosMl: venta ? pauta / (venta * IVA) : null,
  };
}

function resumen(ordenes: FilaRentaMeli[], ads: { fecha: string; gasto: number; atribuidas: number }[], desde: string, hasta: string) {
  const fechas = listaDias(desde, hasta);
  const enRango = (f: string) => f >= desde && f <= hasta;
  const os = ordenes.filter((o) => enRango(o.fecha));
  const as = ads.filter((a) => enRango(a.fecha));
  const adsDia = new Map(as.map((a) => [a.fecha, a]));
  const dias = fechas.map((fecha) => {
    const t = sumar(os.filter((o) => o.fecha === fecha));
    const a = adsDia.get(fecha);
    const d = debajo(t, [fecha], a?.gasto ?? 0);
    return { fecha, ...t, ...d, atribuidas: a?.atribuidas ?? 0, ...ratios(t.venta, d.ganancia, d.pauta, a?.atribuidas ?? 0) };
  });
  const t = sumar(os);
  const pauta = as.reduce((s, a) => s + a.gasto, 0);
  const atribuidas = as.reduce((s, a) => s + a.atribuidas, 0);
  // Pichón se calcula por día (arranca el 1-oct): se suma lo de cada día.
  const pichon = dias.reduce((s, d) => s + d.pichon, 0);
  const nubimetrics = fechas.length * NUBIMETRICS_DIA;
  const ganancia = t.neto - pauta;
  return {
    total: {
      ...t,
      pauta,
      atribuidas,
      pichon,
      nubimetrics,
      ganancia,
      gananciaFinal: ganancia - pichon - nubimetrics,
      ...ratios(t.venta, ganancia, pauta, atribuidas),
      sinCosto: os.reduce((s, o) => s + o.sin_costo, 0),
      flexEstimados: os.filter((o) => o.flex_estimado).length,
    },
    dias,
    ordenes: os,
  };
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    // ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD para un rango a medida (p. ej. para comparar contra otra fuente)
    const [desde, hasta] = dia.test(q.get('desde') ?? '') && dia.test(q.get('hasta') ?? '') ? [q.get('desde')!, q.get('hasta')!] : rango(q.get('periodo'));
    // Período anterior del mismo largo, pegado antes (como compara Escalafy).
    const largo = listaDias(desde, hasta).length;
    const finAnt = new Date(`${desde}T12:00:00Z`);
    finAnt.setUTCDate(finAnt.getUTCDate() - 1);
    const iniAnt = new Date(finAnt);
    iniAnt.setUTCDate(iniAnt.getUTCDate() - (largo - 1));
    const [desdeAnt, hastaAnt] = [iniAnt.toISOString().slice(0, 10), finAnt.toISOString().slice(0, 10)];

    const { actualizado, primerDia, ordenes, ads } = await getRentabilidadMeli(desdeAnt, hasta);
    const actual = resumen(ordenes, ads, desde, hasta);
    const anterior = desdeAnt >= primerDia ? resumen(ordenes, ads, desdeAnt, hastaAnt).total : null;

    const porItem = new Map<string, FilaRentaMeli[]>();
    for (const o of actual.ordenes) porItem.set(o.item_id, [...(porItem.get(o.item_id) ?? []), o]);
    // Foto de portada de cada publicación (si ML no responde, la tabla sale sin fotos).
    const fotos = await fetchThumbnails([...porItem.keys()]).catch(() => new Map<string, string>());
    const productos = [...porItem.entries()]
      .map(([item_id, fs]) => ({ item_id, titulo: fs[0].titulo, foto: fotos.get(item_id) ?? null, sinCosto: fs.some((f) => f.sin_costo > 0), ...sumar(fs) }))
      .sort((a, b) => b.venta - a.venta);

    const porLogistica = new Map<string, FilaRentaMeli[]>();
    for (const o of actual.ordenes) porLogistica.set(o.logistica, [...(porLogistica.get(o.logistica) ?? []), o]);
    const logisticas = [...porLogistica.entries()]
      .map(([logistica, fs]) => ({ logistica, ...sumar(fs) }))
      .sort((a, b) => b.venta - a.venta);

    return Response.json({
      desde,
      hasta,
      actualizado,
      total: actual.total,
      anterior: anterior && { ...anterior, desde: desdeAnt, hasta: hastaAnt },
      serie: actual.dias,
      dias: actual.dias.filter((d) => d.ordenes || d.pauta).reverse(),
      productos,
      logisticas,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
