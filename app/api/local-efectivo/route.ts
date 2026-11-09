import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { saldos, agregarMovimiento } from '@/lib/localEfectivo';

// Caja de efectivo del local (planilla "Mateando_Flujo_Efectivo COSTA RICA", pestaña Movimientos) para la app aparte
// de la caja (mateando-local.vercel.app). Columnas: A fecha (solo en la 1ª fila del día) · B tipo · C categoría ·
// D detalle · E ingreso $ · F egreso $ · G saldo $ (fórmula) · H USD (+ entra / − sale) · I saldo USD · J euros ·
// K saldo euros · L observaciones.
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const ORIGEN = 'https://mateando-local.vercel.app';
const CORS = { 'access-control-allow-origin': ORIGEN, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin' };

// Clave del local (variable LOCAL_CAJA_PIN en Vercel). Mientras se desarrolla la caja (8-nov-2026, pedido de Juampi)
// no hay variable y la ruta responde sin clave; al cargarla, la caja empieza a pedirla.
function sinPermiso(req: Request) {
  const pin = process.env.LOCAL_CAJA_PIN;
  if (!pin || req.headers.get('x-pin') === pin) return null;
  return Response.json({ error: 'Clave incorrecta' }, { status: 401, headers: CORS });
}

const num = (s: unknown) => Number(String(s ?? '').replace(/[$\s,]/g, '')) || 0;
const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10).split('-').reverse().join('/');
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

async function filas() {
  const r = await sheets().spreadsheets.values.get({ spreadsheetId: ID, range: 'Movimientos!A4:L' });
  return r.data.values ?? [];
}

export async function OPTIONS() {
  return new Response(null, { headers: CORS });
}

// Saldo en pesos y dólares (última fila con saldo) y los movimientos del día.
export async function GET(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const v = await filas();
    let saldo = 0, saldoUsd = 0, fecha = '';
    const conFecha: { fecha: string; f: string[] }[] = [];
    for (const f of v) {
      if (f[0]) fecha = f[0];
      if (f[6]) saldo = num(f[6]);
      if (f[8] !== undefined && f[8] !== '') saldoUsd = num(f[8]);
      if (f[1]) conFecha.push({ fecha, f });
    }
    const hoy = hoyAR();
    const movs = conFecha.filter((x) => x.fecha === hoy).map(({ f }) => ({
      tipo: f[1], categoria: f[2], detalle: f[3], pesos: num(f[4]) - num(f[5]), usd: num(f[7]), obs: f[11] ?? '',
    }));
    return Response.json({ saldo, saldoUsd, hoy, movs, ultimaFecha: fecha }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

// Agrega un movimiento con el mismo formato que cargan las chicas (los saldos quedan como fórmula).
export async function POST(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const b = await req.json();
    if (b.cierre) return cierre(b);
    const tipo = b.tipo === 'Egreso' ? 'Egreso' : 'Ingreso';
    const categoria = String(b.categoria ?? '').slice(0, 40);
    const pesos = Math.abs(Number(b.pesos) || 0), usd = Number(b.usd) || 0;
    if (!categoria || (!pesos && !usd)) return Response.json({ error: 'Falta monto o categoría' }, { status: 400, headers: CORS });
    const n = await agregarMovimiento({ tipo, categoria, detalle: String(b.detalle ?? '').slice(0, 120), pesos, usd,
      vuelto: Math.abs(Number(b.vuelto) || 0), obs: String(b.obs ?? '').slice(0, 200) || 'Caja local' });
    return Response.json({ ok: true, fila: n }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

// Cierre de caja: la cajera cuenta la plata y se compara con el saldo de la planilla. Queda registrado en la pestaña
// "Cierres Caja" (no toca Movimientos: si hay diferencia, se ve ahí y se decide aparte).
const CIERRES = 'Cierres Caja';
async function cierre(b: Record<string, unknown>) {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets?.some((x) => x.properties?.title === CIERRES)) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: CIERRES, gridProperties: { frozenRowCount: 1 } } } }] } });
    await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${CIERRES}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[
      'fecha_hora', 'cajera', 'esperado_pesos', 'contado_pesos', 'diferencia_pesos', 'esperado_usd', 'contado_usd', 'diferencia_usd', 'observaciones']] } });
  }
  const { saldo, saldoUsd } = saldos(await filas());
  const contado = Math.round(Number(b.contado) || 0), contadoUsd = Math.round(Number(b.contadoUsd) || 0);
  const ahora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const fila = [ahora, String(b.cajera ?? '').slice(0, 40), saldo, contado, contado - saldo, saldoUsd, contadoUsd, contadoUsd - saldoUsd, String(b.obs ?? '').slice(0, 200)];
  await s.spreadsheets.values.append({ spreadsheetId: ID, range: `'${CIERRES}'!A:I`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
  return Response.json({ ok: true, esperado: saldo, esperadoUsd: saldoUsd, dif: contado - saldo, difUsd: contadoUsd - saldoUsd }, { headers: CORS });
}
