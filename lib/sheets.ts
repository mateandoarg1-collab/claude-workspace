import { google } from 'googleapis';
import { desdeAR, hastaAR, type Periodo } from './periodo';

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
