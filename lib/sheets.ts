import { google } from 'googleapis';
import { desdeAR, hastaAR, type Periodo } from './periodo';
import costosBase from '../scripts/cmv/costos_base.json';
import costosOverride from '../scripts/cmv/costos_override.json';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

const MESES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function currentTabName(now = new Date()): string {
  const mes = MESES[now.getMonth()];
  const yy = String(now.getFullYear()).slice(-2);
  return `${mes} ${yy}`;
}

function parseMonto(raw: string | undefined): number {
  if (!raw) return 0;
  return Number(raw.replace(/\$/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

export function getAuth() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
  return process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
}

export async function getMayoristaSummary() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const tab = currentTabName();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!A2:M2`,
  });

  const row = res.data.values?.[0] ?? [];
  const orders = Number(row[0]) || 0;
  const amount = parseMonto(row[12]); // columna M: MONTO TOTAL

  return { tab, orders, amount };
}

// Mayorista de hoy / ayer / semana: la fecha (dd/mm) va en la col A solo en la 1ª fila de cada pedido;
// las filas siguientes del pedido la heredan. Monto = col M de cada fila.
export async function getMayoristaPeriodo(periodo: Periodo) {
  if (periodo === 'mes') return getMayoristaSummary();
  const desde = desdeAR(periodo);
  const hasta = hastaAR(periodo);
  const tabs = [...new Set([desde, hasta].map((d) => currentTabName(new Date(`${d}T12:00:00-03:00`))))];
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  let orders = 0;
  let amount = 0;
  for (const tab of tabs) {
    const anio = 2000 + Number(tab.slice(-2));
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A3:M` });
    let dia = '';
    for (const r of res.data.values ?? []) {
      const m = String(r[0] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
      if (m) {
        dia = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (dia >= desde && dia <= hasta) orders += 1;
      }
      if (dia && dia >= desde && dia <= hasta) amount += parseMonto(r[12]);
    }
  }
  return { tab: tabs.join(' + '), orders, amount };
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
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const tab = currentTabName(new Date(`${desde}T12:00:00-03:00`));
  const anio = 2000 + Number(tab.slice(-2));
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A3:M` });
  const dias = new Map<string, { ventas: number; monto: number }>();
  let dia = '';
  for (const r of res.data.values ?? []) {
    const m = String(r[0] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
      dia = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      const d = dias.get(dia) ?? { ventas: 0, monto: 0 };
      d.ventas += 1;
      dias.set(dia, d);
    }
    if (dia) {
      const d = dias.get(dia) ?? { ventas: 0, monto: 0 };
      d.monto += parseMonto(r[12]);
      dias.set(dia, d);
    }
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
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'cmv_empretienda'!A2:H` })
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
  }));
}

// Costo por SKU: scripts/cmv/costos_base.json, encima la planilla "Costos JP - meli" (col F SKU, col G costo neto)
// y encima scripts/cmv/costos_override.json. Mismo criterio que el CMV de Empretienda (scripts/empretienda-metricas.mjs).
const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
export async function getCostosSku(): Promise<Record<string, number>> {
  const costos: Record<string, number> = { ...(costosBase as Record<string, number>) };
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
  for (const [k, v] of Object.entries(costosOverride)) if (!k.startsWith('_') && typeof v === 'number') costos[k] = v;
  return costos;
}
