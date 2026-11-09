import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Ventas del local para /canales. Hasta el 8-nov-2026 el local se cargaba en Empretienda como «Acordar»; desde el
// 9-nov-2026 sale de la caja propia (mateando-local.vercel.app), pestaña "Ventas Caja" de la planilla de Flujo Efectivo.
export const CORTE_CAJA = '2026-11-09';
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';

// Ventas de la caja (no anuladas) por día AR, entre desde y hasta (inclusive), nunca antes del corte.
export async function cajaPorDia(desde: string, hasta: string) {
  const dias = new Map<string, { ventas: number; monto: number }>();
  const d0 = desde < CORTE_CAJA ? CORTE_CAJA : desde;
  if (d0 > hasta) return dias;
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: ID, range: "'Ventas Caja'!A2:O", valueRenderOption: 'UNFORMATTED_VALUE' });
  for (const f of r.data.values ?? []) {
    if (!f[0] || f[14] === 'anulada') continue;
    const dia = String(f[1] ?? '').slice(0, 10); // "YYYY-MM-DD HH:MM" en hora Argentina
    if (dia < d0 || dia > hasta) continue;
    const x = dias.get(dia) ?? { ventas: 0, monto: 0 };
    x.ventas += 1;
    x.monto += Math.round(Number(f[10]) || 0);
    dias.set(dia, x);
  }
  return dias;
}
