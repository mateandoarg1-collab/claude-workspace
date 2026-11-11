import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Ventas de Empretienda para la caja del local: unidades por producto (ranking) y las ventas del local (Acordar,
// pagadas) para Métricas. Las usan /api/local-caja (ranking) y /api/local-metricas (con clave).
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

export async function ventas() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const [ro, rv] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: EMP, range: "'emp_ordenes'!A2:H", valueRenderOption: 'UNFORMATTED_VALUE' }),
    sheets.spreadsheets.values.get({ spreadsheetId: EMP, range: "'emp_ventas'!A2:R", valueRenderOption: 'UNFORMATTED_VALUE' }),
  ]);
  const medio: Record<string, string> = {};
  for (const v of rv.data.values ?? []) medio[String(v[0])] = v[17] || '';
  const vendidos: Record<string, number> = {}, local: Record<string, number> = {};
  const lista = [];
  for (const o of ro.data.values ?? []) {
    if (String(o[5]) !== '1') continue;
    const esLocal = String(o[4]) === '3';
    let u = 0;
    const it: [string, number][] = []; // productos del pedido (id de Empretienda, unidades): ranking de Métricas
    for (const x of String(o[7] ?? '').split(',').filter(Boolean)) {
      const [id, c] = x.split(':'); const n = Number(c) || 1; u += n; it.push([id, n]);
      vendidos[id] = (vendidos[id] ?? 0) + n;
      if (esLocal) local[id] = (local[id] ?? 0) + n;
    }
    if (!esLocal) continue;
    const d = new Date(Date.parse(o[2]) - 3 * 3600e3);
    lista.push({ f: d.toISOString().slice(0, 10), h: d.getUTCHours(), dow: d.getUTCDay(), t: Number(o[3]) || 0, m: medio[String(o[0])] || 'sin dato', u, it });
  }
  return { vendidos, local, lista };
}
