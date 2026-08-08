import { google } from 'googleapis';
import { getAuth } from './sheets';

const SPREADSHEET_ID = '1UpKb4hhNDZFrNoxH2kIIBXIWBnHStHVflHJ1RKrvXYo';
const TAB = 'Datos Manychat';

function parseImporte(s: string) {
  return Number(s.replace(/\$\s?/, '').replace(/\./g, '').replace(',', '.')) || 0;
}

export async function getComprobantesSummary(yearMonthPrefix: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A2:C`,
  });
  const rows = res.data.values ?? [];

  // Dedupe por número de orden: si el mismo pedido aparece más de una vez
  // (comprobante reenviado, etc.), se cuenta una sola vez.
  const byOrder = new Map<string, number>();
  for (const [fecha, orden, importe] of rows) {
    if (!fecha || !orden || !String(fecha).startsWith(yearMonthPrefix)) continue;
    if (byOrder.has(orden)) continue;
    byOrder.set(orden, parseImporte(importe ?? '0'));
  }

  return {
    orders: byOrder.size,
    amount: Array.from(byOrder.values()).reduce((s, v) => s + v, 0),
  };
}
