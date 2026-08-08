import { google } from 'googleapis';
import { getAuth } from './sheets';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'local_ventas';

async function ensureTab(sheets: ReturnType<typeof google.sheets>) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === TAB);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Fecha', 'Monto', 'Método']] },
  });
}

export async function addLocalVenta(monto: number, metodo: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await ensureTab(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A:C`,
    valueInputOption: 'RAW',
    requestBody: { values: [[new Date().toISOString(), monto, metodo]] },
  });
}

export async function getLocalVentasSummary(yearMonthPrefix: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await ensureTab(sheets);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A2:C`,
  });
  const rows = res.data.values ?? [];

  let orders = 0;
  let amount = 0;
  let efectivo = 0;
  let transferencia = 0;
  for (const [fecha, monto, metodo] of rows) {
    if (!String(fecha).startsWith(yearMonthPrefix)) continue;
    const m = Number(monto) || 0;
    orders++;
    amount += m;
    if (metodo === 'efectivo') efectivo += m;
    else if (metodo === 'transferencia') transferencia += m;
  }

  return { orders, amount, efectivo, transferencia };
}
