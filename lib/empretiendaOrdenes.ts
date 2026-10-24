import { google } from 'googleapis';
import { getAuth } from './sheets';

// Órdenes y catálogo de Empretienda que vuelca scripts/empretienda-ordenes.mjs (GitHub Actions, cada 30 min, 60 días).
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

export const PAGO = { pagada: '1', pendiente: '0', devuelta: '4', fallida: '5' } as const;
export const ACORDAR = '3'; // = Local Físico

export type Orden = {
  id: string; // = order_id de la página de gracias en GA4
  dia: string; // YYYY-MM-DD hora AR
  total: number;
  metodo: string;
  pago: string;
  provincia: string;
  productos: { id: string; cant: number }[];
};
export type Producto = { id: string; nombre: string; link: string; imagen: string };

export async function getOrdenes(): Promise<{ ordenes: Orden[]; productos: Producto[] }> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: ["'emp_ordenes'!A2:H", "'emp_productos'!A2:E"],
    valueRenderOption: 'UNFORMATTED_VALUE', // formateados vienen con coma decimal ("123398,01")
  });
  const [o, p] = r.data.valueRanges ?? [];
  const ordenes = (o?.values ?? []).map((x) => ({
    id: String(x[0]),
    dia: new Date(Date.parse(x[2]) - 3 * 3600e3).toISOString().slice(0, 10),
    total: Number(x[3]) || 0,
    metodo: String(x[4] ?? ''),
    pago: String(x[5] ?? ''),
    provincia: String(x[6] ?? ''),
    productos: String(x[7] ?? '')
      .split(',')
      .filter(Boolean)
      .map((s) => {
        const [id, cant] = s.split(':');
        return { id, cant: Number(cant) || 0 };
      }),
  }));
  const productos = (p?.values ?? []).map((x) => ({ id: String(x[0]), nombre: String(x[1] ?? ''), link: String(x[2] ?? ''), imagen: String(x[4] ?? '') }));
  return { ordenes, productos };
}
