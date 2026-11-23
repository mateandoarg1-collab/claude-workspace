import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { CORTE_CAJA } from '@/lib/localCajaPeriodo';
import { getPagosLocal, type PagoLocal } from '@/lib/mercadopago';

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

// Medio de pago de las ventas del local cargadas en Empretienda (26-oct → corte de la caja). La nota de las chicas solo
// distinguía transferencia y efectivo, y sin nota se tomaba como tarjeta: eso inflaba la tarjeta (~$5 M de más del 26/10
// al 8/11; con MP se confirman $4,3 M de $11,5 M). Juampi, 22-nov-2026: "cuando no se sabe" no es tarjeta. Ahora es
// "tarjeta" solo si hay un cobro de Point/QR de Mercado Pago ese día por el mismo monto (±$1, cada cobro una sola vez);
// si no, "sin dato".
const DESDE_NOTA = '2026-10-26';
let cachePagos: { t: number; pagos: PagoLocal[] } | null = null;
export async function conTarjetaVerificada<T extends { f: string; t: number; m: string }>(lista: T[]): Promise<T[]> {
  const dudosas = lista.filter((x) => x.f >= DESDE_NOTA && x.f < CORTE_CAJA && (x.m === 'tarjeta' || x.m === 'sin dato'));
  if (!dudosas.length) return lista;
  let pagos: PagoLocal[] = [];
  try {
    if (!cachePagos || Date.now() - cachePagos.t > 6 * 3600e3) {
      const p = await getPagosLocal(`${DESDE_NOTA}T00:00:00.000-03:00`, `${CORTE_CAJA}T00:00:00.000-03:00`);
      if (p.length) cachePagos = { t: Date.now(), pagos: p }; // el período ya cerró: no cambia
    }
    pagos = cachePagos?.pagos ?? [];
  } catch { /* sin Mercado Pago no se puede confirmar ninguna → quedan "sin dato" */ }
  const dia = (ms: number) => new Date(ms - 3 * 3600e3).toISOString().slice(0, 10);
  const tomados = new Set<number>(), ok = new Set<T>();
  for (const x of [...dudosas].sort((a, b) => b.t - a.t)) {
    const p = pagos.find((y) => !tomados.has(y.id) && dia(y.fecha) === x.f && Math.abs(y.monto - x.t) <= 1);
    if (p) { tomados.add(p.id); ok.add(x); }
  }
  const dud = new Set(dudosas);
  return lista.map((x) => (dud.has(x) ? { ...x, m: ok.has(x) ? 'tarjeta' : 'sin dato' } : x));
}
