import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Caja de efectivo del local (planilla "Mateando_Flujo_Efectivo COSTA RICA", pestaña Movimientos) para la app aparte
// de la caja (mateando-local.vercel.app). Columnas: A fecha (solo en la 1ª fila del día) · B tipo · C categoría ·
// D detalle · E ingreso $ · F egreso $ · G saldo $ (fórmula) · H USD (+ entra / − sale) · I saldo USD · J euros ·
// K saldo euros · L observaciones.
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const ORIGEN = 'https://mateando-local.vercel.app';
const CORS = { 'access-control-allow-origin': ORIGEN, 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin' };

// Solo con la clave del local (variable LOCAL_CAJA_PIN en Vercel, la carga Juampi). Sin la variable, no responde nada.
function sinPermiso(req: Request) {
  const pin = process.env.LOCAL_CAJA_PIN;
  if (pin && req.headers.get('x-pin') === pin) return null;
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
    const tipo = b.tipo === 'Egreso' ? 'Egreso' : 'Ingreso';
    const categoria = String(b.categoria ?? '').slice(0, 40);
    const detalle = String(b.detalle ?? '').slice(0, 120);
    const pesos = Math.abs(Number(b.pesos) || 0);
    const usd = Number(b.usd) || 0;
    const vuelto = Math.abs(Number(b.vuelto) || 0); // venta en dólares con vuelto en pesos
    if (!categoria || (!pesos && !usd)) return Response.json({ error: 'Falta monto o categoría' }, { status: 400, headers: CORS });

    const v = await filas();
    let fecha = '';
    for (const f of v) if (f[0]) fecha = f[0];
    const n = v.length + 4; // fila nueva (los datos arrancan en la 4)
    const fila = [
      fecha === hoyAR() ? '' : hoyAR(), tipo, categoria, detalle,
      tipo === 'Ingreso' && pesos ? pesos : '', tipo === 'Egreso' && pesos ? pesos : vuelto || '',
      `=IF(AND(E${n}="",F${n}=""),"",G${n - 1}+IF(E${n}="",0,E${n})-IF(F${n}="",0,F${n}))`,
      usd || '', `=I${n - 1}+IF(H${n}="",0,H${n})`, '', `=K${n - 1}+IF(J${n}="",0,J${n})`,
      String(b.obs ?? '').slice(0, 200) || 'Caja local',
    ];
    await sheets().spreadsheets.values.update({
      spreadsheetId: ID, range: `Movimientos!A${n}:L${n}`, valueInputOption: 'USER_ENTERED', requestBody: { values: [fila] },
    });
    return Response.json({ ok: true, fila: n }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
