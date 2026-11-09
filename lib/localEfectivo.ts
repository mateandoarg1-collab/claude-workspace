import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Planilla "Mateando_Flujo_Efectivo COSTA RICA" del local: pestaña Movimientos (A fecha solo en la 1ª fila del día ·
// B tipo · C categoría · D detalle · E ingreso $ · F egreso $ · G saldo $ · H USD · I saldo USD · J euros · K saldo
// euros · L observaciones; datos desde la fila 4), pestaña "Ventas Caja" y "Cierres Caja".
export const EFECTIVO_ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
export const sheetsRW = () => google.sheets({ version: 'v4', auth: getAuth() });
export const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
const num = (s: unknown) => Number(String(s ?? '').replace(/[$\s,]/g, '')) || 0;

export async function movimientos() {
  const r = await sheetsRW().spreadsheets.values.get({ spreadsheetId: EFECTIVO_ID, range: 'Movimientos!A4:L' });
  return r.data.values ?? [];
}

// Saldo actual en pesos y dólares (última fila con saldo).
export function saldos(v: string[][]) {
  let saldo = 0, saldoUsd = 0, fecha = '';
  for (const f of v) {
    if (f[0]) fecha = f[0];
    if (f[6]) saldo = num(f[6]);
    if (f[8] !== undefined && f[8] !== '') saldoUsd = num(f[8]);
  }
  return { saldo, saldoUsd, ultimaFecha: fecha };
}

// Agrega un movimiento con el mismo formato que cargan las chicas (los saldos quedan como fórmula).
export async function agregarMovimiento(m: { tipo: 'Ingreso' | 'Egreso'; categoria: string; detalle: string; pesos?: number; usd?: number; vuelto?: number; obs?: string }) {
  const v = await movimientos();
  let fecha = '';
  for (const f of v) if (f[0]) fecha = f[0];
  const n = v.length + 4;
  const pesos = Math.abs(m.pesos || 0), vuelto = Math.abs(m.vuelto || 0);
  const fila = [
    fecha === hoyAR() ? '' : hoyAR(), m.tipo, m.categoria, m.detalle,
    m.tipo === 'Ingreso' && pesos ? pesos : '', m.tipo === 'Egreso' && pesos ? pesos : vuelto || '',
    `=IF(AND(E${n}="",F${n}=""),"",G${n - 1}+IF(E${n}="",0,E${n})-IF(F${n}="",0,F${n}))`,
    m.usd || '', `=I${n - 1}+IF(H${n}="",0,H${n})`, '', `=K${n - 1}+IF(J${n}="",0,J${n})`,
    m.obs || 'Caja local',
  ];
  await sheetsRW().spreadsheets.values.update({
    spreadsheetId: EFECTIVO_ID, range: `Movimientos!A${n}:L${n}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [fila] },
  });
  return n;
}
