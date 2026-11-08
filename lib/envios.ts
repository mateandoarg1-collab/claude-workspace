import { google } from 'googleapis';
import { getAuth } from './sheets';

// Panel de envíos (/envios) para Tote: órdenes de Empretienda de los últimos días con el estado real del paquete en OCA.
// - Órdenes: pestaña emp_ventas (la llena el servidor DonWeb cada 30 min, ver scripts/empretienda-ordenes.mjs).
// - OCA: servicios públicos de e-Pak (developers.oca.com.ar/epak.html), sin usuario. List_Envios da los envíos del CUIT
//   por fecha de alta con NroProducto = número de orden de Empretienda; Tracking_Pieza da cada evento con sucursal y hora.
// Empretienda no guarda el número de OCA en la orden (shipping.tracking_number viene vacío), por eso se cruza así.
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const OCA = 'https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx';
const CUIT = '30-71761250-3'; // Andomat 611 SRL

export type Evento = { fecha: string; estado: string; sucursal: string; motivo: string };
export type Paquete = { numero: string; eventos: Evento[] };
export type Etapa =
  | 'pago_pendiente' | 'preparar' | 'etiqueta' | 'en_oca' | 'en_viaje' | 'en_destino' | 'en_reparto' | 'en_sucursal'
  | 'problema' | 'entregado' | 'express' | 'retiro_local' | 'acordar';
export type OrdenEnvio = {
  numero: string; fecha: string; total: number; pago: string; envio: string; ciudad: string; provincia: string; cp: string;
  productos: string[]; etapa: Etapa; detalle: string; desde: string | null; paquetes: Paquete[]; alerta: string | null;
};

const ahora = () => Date.now();
const fechaOca = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
const xml = (t: string, tag: string) => [...t.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1].trim());

async function listarEnvios(dias: number): Promise<Map<string, string[]>> {
  const desde = new Date(ahora() - 3 * 3600e3 - dias * 864e5);
  const hasta = new Date(ahora() - 3 * 3600e3 + 864e5);
  const r = await fetch(`${OCA}/List_Envios?CUIT=${CUIT}&FechaDesde=${fechaOca(desde)}&FechaHasta=${fechaOca(hasta)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`OCA List_Envios HTTP ${r.status}`);
  const t = await r.text();
  const m = new Map<string, string[]>();
  for (const fila of t.split('<Table ').slice(1)) {
    const prod = xml(fila, 'NroProducto')[0];
    const env = xml(fila, 'NumeroEnvio')[0];
    if (prod && env) m.set(prod, [...(m.get(prod) ?? []), env]);
  }
  return m;
}

async function seguir(numero: string): Promise<Paquete> {
  try {
    const r = await fetch(`${OCA}/Tracking_Pieza?NroDocumentoCliente=&CUIT=&Pieza=${numero}`, { cache: 'no-store' });
    const t = await r.text();
    const eventos = t.split('<Table ').slice(1).map((f) => ({
      fecha: (xml(f, 'fecha')[0] ?? '').replace(' ', 'T').slice(0, 16), // hora AR
      estado: (xml(f, 'Desdcripcion_Estado')[0] ?? '').replace(/\s+-\s+Suc:.*$/, '').replace(/\s{2,}/g, ' '),
      sucursal: (xml(f, 'SUC')[0] ?? '').replace(/^Suc:\s*/, ''),
      motivo: xml(f, 'Descripcion_Motivo')[0] ?? '',
    }));
    return { numero, eventos };
  } catch {
    return { numero, eventos: [] };
  }
}

async function enLotes<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) out.push(...(await Promise.all(xs.slice(i, i + n).map(fn))));
  return out;
}

// Estado de OCA → etapa del panel (según los textos reales de Tracking_Pieza, nov-2026).
function etapaOca(e: Evento): Etapa {
  const s = e.estado;
  if (/NO Entregado|No entregado|Reprogramado|devol|siniestr|rechaz|impos/i.test(s) || (e.motivo && !/sin motivo/i.test(e.motivo))) return 'problema';
  if (/entregado/i.test(s)) return 'entregado';
  if (/espera de retiro|sucursal/i.test(s)) return 'en_sucursal';
  if (/visita|distribuci[oó]n$|reparto/i.test(s)) return 'en_reparto';
  if (/arribado/i.test(s)) return 'en_destino';
  if (/en viaje|tr[aá]nsito/i.test(s)) return 'en_viaje';
  if (/proceso de retiro/i.test(s)) return 'etiqueta';
  return 'en_oca';
}
const ORDEN_ETAPA: Etapa[] = ['problema', 'etiqueta', 'en_oca', 'en_viaje', 'en_destino', 'en_reparto', 'en_sucursal', 'entregado'];

const horas = (iso: string | null) => (iso ? (ahora() - (Date.parse(iso + (iso.length <= 16 ? ':00-03:00' : ''))) ) / 3600e3 : 0);

export async function getEnvios(dias = 3): Promise<OrdenEnvio[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const [ventasR, envios] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'emp_ventas'!A2:R", valueRenderOption: 'UNFORMATTED_VALUE' }),
    listarEnvios(dias),
  ]);
  // Órdenes de los últimos `dias` días + las más viejas que tuvieron etiqueta de OCA en esos días (después de un Cyber
  // se despacha con atraso: son justo los paquetes que están viajando).
  const corte = new Date(ahora() - dias * 864e5).toISOString();
  const ventas = (ventasR.data.values ?? []).filter((v) => (String(v[2]) >= corte || envios.has(String(v[1]))) && ['0', '1'].includes(String(v[4])));
  const piezas = [...new Set(ventas.flatMap((v) => envios.get(String(v[1])) ?? []))];
  const seguidas = new Map((await enLotes(piezas, 25, seguir)).map((p) => [p.numero, p]));

  return ventas.map((v) => {
    const numero = String(v[1]);
    const label = String(v[12] ?? '');
    const metodo = String(v[11] ?? '');
    let productos: string[] = [];
    try {
      productos = (JSON.parse(String(v[16] || '[]')) as { n: string; q: number; v: string }[]).map((p) => `${p.q}× ${p.n}${p.v ? ` (${p.v})` : ''}`);
    } catch {}
    const paquetes = (envios.get(numero) ?? []).map((n) => seguidas.get(n) ?? { numero: n, eventos: [] });
    const base = {
      numero, fecha: String(v[2]), total: Number(v[6]) - Number(v[7] || 0) - Number(v[8] || 0) + Number(v[9] || 0),
      pago: String(v[4]) === '1' ? 'pagada' : 'pendiente', envio: label, ciudad: String(v[15] ?? ''), provincia: String(v[14] ?? ''),
      cp: String(v[13] ?? ''), productos, paquetes,
    };
    const hOrden = horas(base.fecha);
    const res = (etapa: Etapa, detalle: string, desde: string | null, alerta: string | null = null): OrdenEnvio => ({ ...base, etapa, detalle, desde, alerta });

    if (base.pago === 'pendiente') return res('pago_pendiente', 'Esperando el pago (transferencia sin confirmar)', null);
    if (/24 ?HS|express|prioritario/i.test(label)) return res('express', 'Express 24 hs · Logística Z', null);
    if (metodo === '2' || /retiro|local/i.test(label)) return res('retiro_local', label || 'Retiro en el local', null);
    if (metodo === '3') return res('acordar', 'Envío a acordar', null);
    if (!/OCA/i.test(label)) return res('preparar', label || 'Sin medio de envío', null);
    if (!paquetes.length) return res('preparar', 'Sin etiqueta de OCA todavía', null, hOrden > 72 ? `Pagada hace ${Math.round(hOrden / 24)} días y sin etiqueta` : null);

    // Con varios paquetes manda el más atrasado (o el que tiene problema).
    const estados = paquetes.map((p) => {
      const ult = p.eventos.at(-1);
      return ult ? { etapa: etapaOca(ult), ev: ult } : { etapa: 'etiqueta' as Etapa, ev: null };
    });
    const peor = estados.sort((a, b) => ORDEN_ETAPA.indexOf(a.etapa) - ORDEN_ETAPA.indexOf(b.etapa))[0];
    const ev = peor.ev;
    const detalle = ev
      ? `${ev.estado}${ev.sucursal ? ` · ${ev.sucursal}` : ''}${ev.motivo && !/sin motivo/i.test(ev.motivo) ? ` (${ev.motivo})` : ''}`
      : 'Etiqueta hecha, falta que OCA la retire';
    const hEv = ev ? horas(ev.fecha) : hOrden;
    let alerta: string | null = null;
    if (peor.etapa === 'problema') alerta = ev?.motivo && !/sin motivo/i.test(ev.motivo) ? ev.motivo : 'Problema en la entrega';
    else if (peor.etapa === 'en_sucursal' && hEv > 72) alerta = `Hace ${Math.round(hEv / 24)} días esperando en sucursal`;
    else if (peor.etapa !== 'entregado' && peor.etapa !== 'etiqueta' && hEv > 72) alerta = `Sin movimiento hace ${Math.round(hEv / 24)} días`;
    return res(peor.etapa, detalle, ev?.fecha ?? null, alerta);
  });
}
