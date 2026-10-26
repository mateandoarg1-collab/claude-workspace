import { getRentabilidadMeli, type FilaRentaMeli } from '@/lib/sheets';
import { fetchThumbnails } from '@/lib/ml';
import { adicionalDelDia, getCostosAdicionales, type CostoAdicional } from '@/lib/costosMeli';
import { desdeAR, hastaAR } from '@/lib/periodo';

export const maxDuration = 30;

const IVA = 1.21;

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

// Pauta y costos adicionales de un día (pestaña costos_adicionales, se cargan en /rentabilidad-meli/costos).
// `ganancia` es la de Escalafy (neto − ML Ads): ahí los costos adicionales no restan en el canal. `gananciaFinal` sí.
function debajo(t: Totales, fecha: string, pauta: number, adicionales: CostoAdicional[]) {
  const otros = adicionales.map((c) => adicionalDelDia(c, fecha, { venta: t.venta, pauta, ordenes: t.ordenes }));
  const sumaOtros = otros.reduce((s, x) => s + x, 0);
  return { pauta, otros, adicionales: sumaOtros, ganancia: t.neto - pauta, gananciaFinal: t.neto - pauta - sumaOtros };
}

function listaDias(desde: string, hasta: string) {
  const out: string[] = [];
  for (const d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// Indicadores de publicidad. Sin sufijo, como Escalafy (sin IVA): ROAS = ventas atribuidas ÷ inversión, ACOS = al revés,
// TACOS = inversión ÷ facturación total. Los "Ml" como el panel de ML Ads (con IVA): ahí el TACOS es inversión ÷
// (ventas por publicidad + ventas orgánicas de las publicaciones que están en campañas).
function ratios(venta: number, ganancia: number, pauta: number, atribuidas: number, organicas: number) {
  const atribSinIva = atribuidas / IVA;
  return {
    margen: venta ? ganancia / venta : null,
    roas: pauta ? atribSinIva / pauta : null,
    acos: atribSinIva ? pauta / atribSinIva : null,
    tacos: venta ? pauta / venta : null,
    roasMl: pauta ? atribuidas / pauta : null,
    acosMl: atribuidas ? pauta / atribuidas : null,
    tacosMl: atribuidas + organicas ? pauta / (atribuidas + organicas) : null,
  };
}

function resumen(ordenes: FilaRentaMeli[], ads: { fecha: string; gasto: number; atribuidas: number; organicas: number }[], adicionales: CostoAdicional[], desde: string, hasta: string) {
  const fechas = listaDias(desde, hasta);
  const enRango = (f: string) => f >= desde && f <= hasta;
  const os = ordenes.filter((o) => enRango(o.fecha));
  const as = ads.filter((a) => enRango(a.fecha));
  const adsDia = new Map(as.map((a) => [a.fecha, a]));
  const dias = fechas.map((fecha) => {
    const t = sumar(os.filter((o) => o.fecha === fecha));
    const a = adsDia.get(fecha);
    const d = debajo(t, fecha, a?.gasto ?? 0, adicionales);
    return { fecha, ...t, ...d, atribuidas: a?.atribuidas ?? 0, ...ratios(t.venta, d.ganancia, d.pauta, a?.atribuidas ?? 0, a?.organicas ?? 0) };
  });
  const t = sumar(os);
  const pauta = as.reduce((s, a) => s + a.gasto, 0);
  const atribuidas = as.reduce((s, a) => s + a.atribuidas, 0);
  const organicas = as.reduce((s, a) => s + a.organicas, 0);
  // Cada costo adicional se calcula por día (tienen fechas de inicio y fin) y se suma.
  const otros = adicionales.map((c, i) => ({ ...c, total: dias.reduce((s, d) => s + d.otros[i], 0) }));
  const sumaOtros = otros.reduce((s, c) => s + c.total, 0);
  const ganancia = t.neto - pauta;
  return {
    total: {
      ...t,
      pauta,
      atribuidas,
      otros: otros.filter((c) => c.total),
      adicionales: sumaOtros,
      ganancia,
      gananciaFinal: ganancia - sumaOtros,
      ...ratios(t.venta, ganancia, pauta, atribuidas, organicas),
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

    const [{ actualizado, primerDia, ordenes, ads }, adicionales] = await Promise.all([getRentabilidadMeli(desdeAnt, hasta), getCostosAdicionales().then((l) => l.filter((c) => c.canal === 'meli'))]);
    const actual = resumen(ordenes, ads, adicionales, desde, hasta);
    const anterior = desdeAnt >= primerDia ? resumen(ordenes, ads, adicionales, desdeAnt, hastaAnt).total : null;

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

    // Ventas del período, de la más nueva a la más vieja, para la tabla de últimas ventas.
    const ventas = [...actual.ordenes]
      .sort((x, y) => (y.creada || y.fecha).localeCompare(x.creada || x.fecha))
      .map((o) => ({
        order_id: o.order_id, pack_id: o.pack_id, fecha: o.fecha, creada: o.creada, titulo: o.titulo, item_id: o.item_id,
        foto: fotos.get(o.item_id) ?? null, logistica: o.logistica, venta: o.venta, neto: o.neto, sin_costo: o.sin_costo,
        flex_estimado: o.flex_estimado, anulada: o.anulada, reembolsado: o.reembolsado, envio_devolucion: o.envio_devolucion,
      }));

    return Response.json({
      desde,
      hasta,
      actualizado,
      ventas,
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
