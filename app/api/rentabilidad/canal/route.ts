import { google } from 'googleapis';
import { conCache } from '@/lib/cache';
import { getAuth } from '@/lib/sheets';
import { aPedido } from '@/lib/mayoristaApp';
import { RECARGO } from '@/lib/anuncios';
import { CORTE_CAJA } from '@/lib/localCajaPeriodo';

export const dynamic = 'force-dynamic';

// Rentabilidad VARIABLE del Local y de Mayorista (?canal=local|mayorista&periodo=hoy|ayer|semana|mes|mesant), para
// /rentabilidad (solapas Local y Mayorista). Mismo criterio que Tienda y Meli: neto de IVA, sin costos fijos.
//  - Local: pestaña "Rentabilidad Local" (la arma scripts/local-rentabilidad.mjs cada hora en DonWeb), venta por venta
//    de la caja propia (desde el 9-nov-2026). Tarjeta/QR: IVA, comisión real de MP, IIBB 5%, deb/cred 1,2%.
//    Transferencia: 3,25% financiera. Efectivo/USD/EUR: nada. Costo de producto + una bolsa por pedido.
//  - Mayorista: pedidos de la app mayorista (App Pedidos), sin anulados ni presupuestos. Venta = neto sin IVA; costo =
//    costo de los productos cargado en el pedido; con factura: IIBB 5% del neto y deb/cred 1,2% del total; pauta de
//    Meta Mayorista (con el recargo de la cuenta).
const EFECTIVO = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const MAYORISTA = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const IIBB = 0.05, DEB_CRED = 0.012;

function rango(p: string) {
  const ar = new Date(Date.now() - 3 * 3600e3);
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  const hoy = dia(ar);
  const menos = (n: number) => { const d = new Date(ar); d.setUTCDate(d.getUTCDate() - n); return dia(d); };
  if (p === 'hoy') return { desde: hoy, hasta: hoy };
  if (p === 'ayer') return { desde: menos(1), hasta: menos(1) };
  if (p === 'semana') return { desde: menos(6), hasta: hoy };
  if (p === 'mesant') {
    const d = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth() - 1, 1));
    const f = new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 0));
    return { desde: dia(d), hasta: dia(f) };
  }
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
}

export type Linea = { clave: string; nombre: string; monto: number; nota?: string };
export type Orden = { id: string; fecha: string; detalle: string; venta: number; costo: number; ganancia: number; sinCosto: boolean };

const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
const get = async (id: string, range: string) =>
  (await sheets().spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];

// Días del local antes del corte (Empretienda «Acordar»): la misma cuenta de Rentabilidad Tienda con canal=local.
type TiendaLocal = { total: Record<string, number>; ventas: { numero: string; fecha: string; creada: string; venta: number; costo: number; packaging: number; neto: number; sin_costo: number }[] };
async function empretiendaLocal(origen: string, desde: string, hasta: string): Promise<TiendaLocal | null> {
  const fin = hasta < CORTE_CAJA ? hasta : '2026-11-08';
  if (desde > fin) return null;
  const r = await fetch(`${origen}/api/tienda/rentabilidad?canal=local&desde=${desde}&hasta=${fin}`, { cache: 'no-store' }).then((x) => x.json());
  if (r.error) throw new Error(`Rentabilidad Tienda (local): ${r.error}`);
  return r;
}

async function local(desde: string, hasta: string, origen: string) {
  const [todas, emp] = await Promise.all([get(EFECTIVO, "'Rentabilidad Local'!A2:N"), empretiendaLocal(origen, desde, hasta)]);
  const filas = todas.filter((f) => {
    const d = String(f[1] ?? '').slice(0, 10);
    return f[0] && d >= desde && d <= hasta;
  });
  const s = (i: number) => filas.reduce((t, f) => t + (Number(f[i]) || 0), 0);
  const e = (k: string) => Number(emp?.total[k] ?? 0);
  const venta = s(3), iva = s(7);
  const partes = [filas.length ? `${filas.length} de la caja` : '', emp?.ventas.length ? `${emp.ventas.length} de Empretienda (hasta el 8-nov)` : ''].filter(Boolean).join(' + ');
  const lineas: Linea[] = [
    { clave: 'venta', nombre: 'Venta neta', monto: venta - iva + e('venta'), nota: 'sin IVA lo facturado (tarjeta y QR); efectivo y transferencias enteros' },
    { clave: 'comision', nombre: 'Comisión de cobro', monto: -(s(6) + s(10) + e('comision')), nota: 'Mercado Pago real de cada pago; transferencias 3,25% de la financiera' },
    { clave: 'iibb', nombre: 'IIBB', monto: -(s(8) + e('impuestos')), nota: '5% de lo facturado sin IVA' },
    { clave: 'debcred', nombre: 'Imp. débitos y créditos', monto: -(s(9) + e('deb_cred')), nota: '1,2% de lo facturado' },
    { clave: 'cmv', nombre: 'Costo de producto', monto: -(s(4) + e('costo')) },
    { clave: 'pack', nombre: 'Bolsa', monto: -(s(5) + e('packaging')), nota: 'una por pedido' },
  ];
  const ordenes: Orden[] = filas.map((f) => ({
    id: `N° ${f[0]}`, fecha: String(f[1]), detalle: 'caja', venta: (Number(f[3]) || 0) - (Number(f[7]) || 0), costo: (Number(f[4]) || 0) + (Number(f[5]) || 0),
    ganancia: Number(f[11]) || 0, sinCosto: !!f[12],
  }));
  for (const v of emp?.ventas ?? []) ordenes.push({ id: `#${v.numero}`, fecha: v.fecha, detalle: 'Empretienda (Acordar)', venta: v.venta, costo: v.costo + v.packaging, ganancia: v.neto, sinCosto: v.sin_costo > 0 });
  return { lineas, ordenes, ventaBruta: venta + e('venta'), nota: partes ? `Pedidos: ${partes}. Desde el 9-nov el local sale de la caja; antes, de los pedidos «Acordar» de Empretienda.` : '' };
}

async function pautaMayorista(desde: string, hasta: string) {
  const token = process.env.META_MAYORISTA_TOKEN;
  const cuentas = (process.env.META_MAYORISTA_ACCOUNTS ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!token || !cuentas.length) return 0;
  const range = encodeURIComponent(JSON.stringify({ since: desde, until: hasta }));
  const g = await Promise.all(cuentas.map(async (c) => {
    const j = await fetch(`https://graph.facebook.com/v21.0/${c}/insights?fields=spend&time_range=${range}&access_token=${token}`, { cache: 'no-store' }).then((r) => r.json());
    if (j.error) throw new Error(`Meta Mayorista: ${j.error.message}`);
    return Number(j.data?.[0]?.spend ?? 0) * (RECARGO[c] ?? 1);
  }));
  return g.reduce((a, b) => a + b, 0);
}

async function mayorista(desde: string, hasta: string) {
  const [filas, pauta] = await Promise.all([get(MAYORISTA, "'App Pedidos'!A2:U"), pautaMayorista(desde, hasta)]);
  const ps = filas.filter((f) => f[0]).map((f) => aPedido(f.map(String)))
    .filter((p) => !p.anulado && p.estado !== 'Presupuesto' && p.fecha >= desde && p.fecha <= hasta);
  let neto = 0, costo = 0, iibb = 0, debcred = 0, sinCosto = 0;
  const ordenes: Orden[] = ps.map((p) => {
    const ib = p.conIva ? p.neto * IIBB : 0, dc = p.conIva ? p.total * DEB_CRED : 0;
    neto += p.neto; costo += p.costo; iibb += ib; debcred += dc;
    if (!p.costo) sinCosto++;
    return { id: `N° ${p.nro}`, fecha: p.fecha, detalle: `${p.cliente}${p.vendedor ? ` · ${p.vendedor}` : ''}${p.conIva ? '' : ' · sin factura'}`,
      venta: p.neto, costo: p.costo, ganancia: p.neto - p.costo - ib - dc, sinCosto: !p.costo };
  });
  const lineas: Linea[] = [
    { clave: 'venta', nombre: 'Venta neta', monto: neto, nota: 'sin IVA' },
    { clave: 'iibb', nombre: 'IIBB', monto: -iibb, nota: '5% del neto, solo pedidos con factura' },
    { clave: 'debcred', nombre: 'Imp. débitos y créditos', monto: -debcred, nota: '1,2% del total, solo con factura' },
    { clave: 'cmv', nombre: 'Costo de producto', monto: -costo, nota: sinCosto ? `${sinCosto} pedidos sin costo cargado` : 'el cargado en cada pedido' },
    { clave: 'pauta', nombre: 'Publicidad', monto: -pauta, nota: 'Meta Mayorista' },
  ];
  return { lineas, ordenes, ventaBruta: ps.reduce((s, p) => s + p.total, 0), nota: '' };
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

async function obtener(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const canal = q.get('canal') === 'mayorista' ? 'mayorista' : 'local';
    const { desde, hasta } = rango(q.get('periodo') ?? 'mes');
    const r = canal === 'local' ? await local(desde, hasta, new URL(req.url).origin) : await mayorista(desde, hasta);
    const ganancia = r.lineas.reduce((s, l) => s + l.monto, 0);
    const ventaNeta = r.lineas[0].monto;
    return Response.json({ canal, desde, hasta, ...r, ganancia, margen: ventaNeta ? ganancia / ventaNeta : null, pedidos: r.ordenes.length,
      sinCosto: r.ordenes.filter((o) => o.sinCosto).length, ordenes: r.ordenes.sort((a, b) => b.fecha.localeCompare(a.fecha)) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
export const GET = conCache(obtener, 300);
