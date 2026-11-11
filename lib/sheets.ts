import { google } from 'googleapis';
import { desdeAR, hastaAR, type Periodo } from './periodo';
import costosBase from '../scripts/cmv/costos_base.json';
import costosOverride from '../scripts/cmv/costos_override.json';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';


export function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
}

// Mayorista: desde el 11-nov-2026 los pedidos se cargan en la app (mateando-mayorista.vercel.app), pestaña
// "App Pedidos" de esta planilla (los de OCT 25–NOV 26 se migraron del Excel). Monto = total con IVA, sin anulados.
export async function getPedidosMayoristaApp(desde: string, hasta: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'App Pedidos'!A2:T`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return (r.data.values ?? [])
    .filter((f) => f[0] && f[19] !== 'SI' && String(f[2]) >= desde && String(f[2]) <= hasta)
    .map((f) => ({ fecha: String(f[2]), total: Number(f[8]) || 0 }));
}

export async function getMayoristaSummary() {
  return getMayoristaPeriodo('mes');
}

export async function getMayoristaPeriodo(periodo: Periodo) {
  const desde = desdeAR(periodo);
  const hasta = hastaAR(periodo);
  const ps = await getPedidosMayoristaApp(desde, hasta);
  return { tab: 'App Pedidos', orders: ps.length, amount: ps.reduce((s, p) => s + p.total, 0) };
}

const MANUAL_TAB = 'dashboard_manual';

export type EmpretiendaManualData = {
  gocuotasMonto: number;
  gocuotasCant: number;
  updatedAt: string;
};

export async function getEmpretiendaManual(): Promise<EmpretiendaManualData> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${MANUAL_TAB}'!A2:C2`,
  });
  const row = res.data.values?.[0] ?? [];
  return {
    gocuotasMonto: Number(row[0]) || 0,
    gocuotasCant: Number(row[1]) || 0,
    updatedAt: row[2] ?? '',
  };
}

export type EmpretiendaMetricas = {
  periodo: Periodo;
  desde: string;
  totalMonto: number;
  totalCant: number;
  acordarMonto: number;
  acordarCant: number;
  updatedAt: string;
};

// Filas 5-8 de dashboard_manual (hoy, semana, mes, ayer): las escribe mateandobot (scripts/empretienda-sync.mjs).
export async function getEmpretiendaMetricas(): Promise<EmpretiendaMetricas[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${MANUAL_TAB}'!A5:G8`,
  });
  return (res.data.values ?? []).map((r) => ({
    periodo: r[0],
    desde: r[1],
    totalMonto: Number(r[2]) || 0,
    totalCant: Number(r[3]) || 0,
    acordarMonto: Number(r[4]) || 0,
    acordarCant: Number(r[5]) || 0,
    updatedAt: r[6] ?? '',
  }));
}

export async function setEmpretiendaManual(data: Omit<EmpretiendaManualData, 'updatedAt'>) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const updatedAt = new Date().toISOString();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${MANUAL_TAB}'!A2:C2`,
    valueInputOption: 'RAW',
    requestBody: { values: [[data.gocuotasMonto, data.gocuotasCant, updatedAt]] },
  });
  return { ...data, updatedAt };
}

// Mayorista por día del mes en curso: pedidos (fila con fecha dd/mm) y monto (col M) por día AR.
export async function getMayoristaDiario(desde: string) {
  const dias = new Map<string, { ventas: number; monto: number }>();
  for (const p of await getPedidosMayoristaApp(desde, '9999-12-31')) {
    const d = dias.get(p.fecha) ?? { ventas: 0, monto: 0 };
    d.ventas += 1;
    d.monto += p.total;
    dias.set(p.fecha, d);
  }
  return dias;
}

// Empretienda por día (pestaña empretienda_diario, la llena scripts/empretienda-metricas.mjs).
export async function getEmpretiendaDiario() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'empretienda_diario'!A2:E` })
    .catch(() => null);
  return (res?.data.values ?? []).map((r) => ({
    dia: String(r[0]),
    totalMonto: Number(r[1]) || 0,
    totalCant: Number(r[2]) || 0,
    acordarMonto: Number(r[3]) || 0,
    acordarCant: Number(r[4]) || 0,
  }));
}

// Costos de Meli por publicación/variante (pestaña costos_meli, la llena scripts/costos-meli-a-planilla.mjs desde
// Escalafy). Clave "MLA…|variation_id" y "MLA…" (la variante sin costo propio usa el de la publicación, como Escalafy).
export async function getCostosMeli() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'costos_meli'!A2:D` });
  const map = new Map<string, { tipo: string; costo: number }>();
  for (const [item, variante, tipo, costo] of res.data.values ?? []) {
    const v = { tipo: String(tipo), costo: Number(costo) || 0 };
    if (variante && variante !== item) map.set(`${item}|${variante}`, v);
    else map.set(String(item), v);
  }
  return map;
}

// CMV de Tienda Online y Local por período (pestaña cmv_empretienda, la llena scripts/empretienda-metricas.mjs).
export async function getEmpretiendaCmv() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'cmv_empretienda'!A2:I` })
    .catch(() => null);
  return (res?.data.values ?? []).map((r) => ({
    periodo: String(r[0]),
    onlineFact: Number(r[1]) || 0,
    onlineCmv: Number(r[2]) || 0,
    onlinePack: Number(r[3]) || 0,
    localFact: Number(r[4]) || 0,
    localCmv: Number(r[5]) || 0,
    localPack: Number(r[6]) || 0,
    updatedAt: String(r[7] ?? ''),
    onlineTransf: r[8] === undefined || r[8] === '' ? null : Number(r[8]) || 0, // ventas por transferencia (sin IVA)
  }));
}

// Costo por SKU: scripts/cmv/costos_base.json, encima scripts/cmv/costos_override.json (lo que la planilla no tiene) y
// encima la planilla "Costos JP - meli" (col F SKU, col G costo neto), que manda. Mismo criterio que el CMV de Empretienda
// (scripts/empretienda-metricas.mjs).
const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
export async function getCostosSku(): Promise<Record<string, number>> {
  const costos: Record<string, number> = { ...(costosBase as Record<string, number>) };
  for (const [k, v] of Object.entries(costosOverride)) if (!k.startsWith('_') && typeof v === 'number') costos[k] = v;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP, fields: 'sheets.properties.title' });
  const hojas = (meta.data.sheets ?? []).map((h) => h.properties?.title ?? '').filter((h) => h && !['BASE scalify', 'Hoja 22'].includes(h));
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: COSTOS_JP, ranges: hojas.map((h) => `'${h}'!F2:G400`) });
  for (const vr of res.data.valueRanges ?? []) {
    for (const [sku, c] of vr.values ?? []) {
      const n = Number(String(c ?? '').replace(/[$\s.]/g, '').replace(',', '.'));
      if (String(sku ?? '').trim() && n > 0) costos[String(sku).trim()] = n;
    }
  }
  return costos;
}

// Rentabilidad de Mercado Libre por orden y pauta de ML Ads por día (pestañas rentabilidad_meli y rentabilidad_meli_ads,
// las llena scripts/meli-rentabilidad.mjs). Importes sin IVA, salvo impuestos (5% de la venta con IVA) y la pauta.
export type FilaRentaMeli = {
  fecha: string; order_id: string; pack_id: string; logistica: string; item_id: string; titulo: string; unidades: number;
  venta: number; comision: number; envio_ml: number; envio_flex: number; impuestos: number; costo: number; neto: number;
  sin_costo: number; flex_estimado: number; anulada: number;
  envio_id: string; variante: string; reembolsado: number; envio_devolucion: number; creada: string;
};
async function leerRentabilidadMeli() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`'rentabilidad_meli'!A1:Z`, `'rentabilidad_meli_ads'!A1:G`],
    valueRenderOption: 'UNFORMATTED_VALUE', // con formato la planilla devuelve "43.041,32"
  });
  const [ordenes, ads] = res.data.valueRanges ?? [];
  const [enc, ...filas] = ordenes?.values ?? [];
  const col = Object.fromEntries((enc ?? []).map((k, i) => [k, i]));
  const num = (r: string[], k: string) => Number(r[col[k]]) || 0;
  const str = (r: string[], k: string) => (col[k] == null ? '' : String(r[col[k]] ?? ''));
  return {
    actualizado: String(enc?.at(-1) ?? ''),
    ordenes: filas.map((r): FilaRentaMeli => ({
      fecha: str(r, 'fecha'), order_id: str(r, 'order_id'), pack_id: str(r, 'pack_id'), logistica: str(r, 'logistica'),
      item_id: str(r, 'item_id'), titulo: str(r, 'titulo'), unidades: num(r, 'unidades'), venta: num(r, 'venta'),
      comision: num(r, 'comision'), envio_ml: num(r, 'envio_ml'), envio_flex: num(r, 'envio_flex'), impuestos: num(r, 'impuestos'),
      costo: num(r, 'costo'), neto: num(r, 'neto'), sin_costo: num(r, 'sin_costo'), flex_estimado: num(r, 'flex_estimado'),
      anulada: num(r, 'anulada'), envio_id: str(r, 'envio_id'), variante: str(r, 'variante'), reembolsado: num(r, 'reembolsado'),
      envio_devolucion: num(r, 'envio_devolucion'), creada: str(r, 'creada'),
    })),
    ads: (ads?.values ?? []).slice(1).map((r) => ({ fecha: String(r[0]), gasto: Number(r[1]) || 0, atribuidas: Number(r[2]) || 0, organicas: Number(r[5]) || 0 })),
  };
}

export async function getRentabilidadMeli(desde: string, hasta: string) {
  const { actualizado, ordenes, ads } = await leerRentabilidadMeli();
  const enRango = (f: string) => f >= desde && f <= hasta;
  return {
    actualizado,
    // Primer día con datos en la planilla (para no comparar contra un período que no está cargado entero).
    primerDia: ordenes.reduce((m, o) => (o.fecha < m ? o.fecha : m), '9999-12-31'),
    ordenes: ordenes.filter((o) => enRango(o.fecha)),
    ads: ads.filter((a) => enRango(a.fecha)),
  };
}

// Las órdenes de una venta, buscando por número de orden o de carrito (pack).
export async function getVentaMeli(id: string) {
  const { actualizado, ordenes } = await leerRentabilidadMeli();
  return { actualizado, ordenes: ordenes.filter((o) => o.order_id === id || o.pack_id === id) };
}
