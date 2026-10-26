import { getRentabilidadTienda, type VentaTienda } from '@/lib/tienda';
import { desdeAR, hastaAR } from '@/lib/periodo';

export const maxDuration = 30;

// Rentabilidad de la tienda de Empretienda (?periodo=hoy|ayer|semana|mes|mesant o ?desde&hasta, &canal=online|local|todo).
// La pauta (Meta de la tienda + Google Ads) va solo contra la venta online, como en /canales.
function rango(p: string | null): [string, string] {
  if (p === 'hoy' || p === 'ayer' || p === 'semana') return [desdeAR(p), hastaAR(p)];
  const inicio = desdeAR('mes');
  if (p !== 'mesant') return [inicio, hastaAR('mes')];
  const fin = new Date(`${inicio}T12:00:00Z`);
  fin.setUTCDate(0);
  return [fin.toISOString().slice(0, 8) + '01', fin.toISOString().slice(0, 10)];
}

function listaDias(desde: string, hasta: string) {
  const out: string[] = [];
  for (const d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

const CAMPOS = ['venta', 'descuentos', 'comision', 'envio_tienda', 'impuestos', 'deb_cred', 'costo', 'packaging', 'neto'] as const;
type Totales = Record<(typeof CAMPOS)[number], number> & { ventas: number; unidades: number };

function sumar(vs: VentaTienda[]): Totales {
  const t = Object.fromEntries(CAMPOS.map((k) => [k, 0])) as Totales;
  for (const v of vs) for (const k of CAMPOS) t[k] += v[k];
  t.ventas = vs.length;
  t.unidades = vs.reduce((s, v) => s + v.unidades, 0);
  return t;
}

// ROAS = facturación ÷ inversión; CPA = inversión por venta; TACOS = inversión ÷ facturación (todo sin IVA).
function indicadores(t: Totales, pauta: number) {
  const ganancia = t.neto - pauta;
  return {
    pauta,
    ganancia,
    margen: t.venta ? ganancia / t.venta : null,
    roas: pauta ? t.venta / pauta : null,
    cpa: t.ventas && pauta ? pauta / t.ventas : null,
    tacos: t.venta ? pauta / t.venta : null,
    ticket: t.ventas ? t.venta / t.ventas : null,
  };
}

function resumen(ventas: VentaTienda[], ads: { fecha: string; meta: number; google: number; total: number }[], desde: string, hasta: string, conPauta: boolean) {
  const vs = ventas.filter((v) => v.fecha >= desde && v.fecha <= hasta);
  const pautaDia = new Map(ads.map((a) => [a.fecha, conPauta ? a.total : 0]));
  const dias = listaDias(desde, hasta).map((fecha) => {
    const t = sumar(vs.filter((v) => v.fecha === fecha));
    return { fecha, ...t, ...indicadores(t, pautaDia.get(fecha) ?? 0) };
  });
  const t = sumar(vs);
  const pauta = dias.reduce((s, d) => s + d.pauta, 0);
  const enRango = ads.filter((a) => conPauta && a.fecha >= desde && a.fecha <= hasta);
  const meta = enRango.reduce((s, a) => s + a.meta, 0);
  const googleAds = enRango.reduce((s, a) => s + a.google, 0);
  return { total: { ...t, ...indicadores(t, pauta), meta, google: googleAds, sinCosto: vs.reduce((s, v) => s + v.sin_costo, 0), sinComision: vs.filter((v) => v.sin_comision).length }, dias, ventas: vs };
}

export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const dia = /^\d{4}-\d{2}-\d{2}$/;
    const [desde, hasta] = dia.test(q.get('desde') ?? '') && dia.test(q.get('hasta') ?? '') ? [q.get('desde')!, q.get('hasta')!] : rango(q.get('periodo'));
    const canal = q.get('canal') === 'local' ? 'local' : q.get('canal') === 'todo' ? 'todo' : 'online';
    const largo = listaDias(desde, hasta).length;
    const finAnt = new Date(`${desde}T12:00:00Z`);
    finAnt.setUTCDate(finAnt.getUTCDate() - 1);
    const iniAnt = new Date(finAnt);
    iniAnt.setUTCDate(iniAnt.getUTCDate() - (largo - 1));
    const [desdeAnt, hastaAnt] = [iniAnt.toISOString().slice(0, 10), finAnt.toISOString().slice(0, 10)];

    const { actualizado, ventas: todas, ads, fotos } = await getRentabilidadTienda();
    const ventas = canal === 'todo' ? todas : todas.filter((v) => v.canal === canal);
    const conPauta = canal !== 'local';
    const primerDia = todas.reduce((m, v) => (v.fecha < m ? v.fecha : m), '9999-12-31');
    const actual = resumen(ventas, ads, desde, hasta, conPauta);
    const anterior = desdeAnt >= primerDia ? resumen(ventas, ads, desdeAnt, hastaAnt, conPauta).total : null;

    // Por producto: el costo y el neto de cada venta se reparten entre sus productos según el precio.
    const porProducto = new Map<string, { id: string; nombre: string; foto: string | null; link: string | null; unidades: number; venta: number; costo: number; neto: number; ventas: number }>();
    for (const v of actual.ventas) {
      const bruto = v.productos.reduce((s, p) => s + p.p * p.q, 0) || 1;
      for (const p of v.productos) {
        const parte = (p.p * p.q) / bruto;
        const x = porProducto.get(p.id) ?? { id: p.id, nombre: p.n, foto: fotos.get(p.id)?.foto ?? null, link: fotos.get(p.id)?.link ?? null, unidades: 0, venta: 0, costo: 0, neto: 0, ventas: 0 };
        x.unidades += p.q;
        x.venta += v.venta * parte;
        x.costo += (v.costo + v.packaging) * parte;
        x.neto += v.neto * parte;
        x.ventas += 1;
        porProducto.set(p.id, x);
      }
    }
    const agrupar = (clave: (v: VentaTienda) => string) => {
      const m = new Map<string, VentaTienda[]>();
      for (const v of actual.ventas) m.set(clave(v), [...(m.get(clave(v)) ?? []), v]);
      return [...m.entries()].map(([nombre, vs]) => ({ nombre, ...sumar(vs) })).sort((a, b) => b.venta - a.venta);
    };

    return Response.json({
      desde,
      hasta,
      canal,
      actualizado,
      total: actual.total,
      anterior: anterior && { ...anterior, desde: desdeAnt, hasta: hastaAnt },
      serie: actual.dias,
      productos: [...porProducto.values()].sort((a, b) => b.venta - a.venta),
      pagos: agrupar((v) => v.pago),
      envios: agrupar((v) => v.envio || 'Sin envío'),
      ventas: [...actual.ventas]
        .sort((a, b) => (b.creada || b.fecha).localeCompare(a.creada || a.fecha))
        .map((v) => ({ ...v, productos: v.productos.map((p) => ({ ...p, foto: fotos.get(p.id)?.foto ?? null })) })),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
