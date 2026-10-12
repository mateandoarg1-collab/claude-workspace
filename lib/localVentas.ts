import { google } from 'googleapis';
import { getAuth } from './sheets';
import { getMercadoPagoLocalSummary } from './mercadopago';

// Venta del local físico (Costa Rica), armada de tres fuentes:
//   1. Mercado Pago Point / QR del local (API de MP).
//   2. Efectivo: planilla "Mateando_Flujo_Efectivo COSTA RICA" que llenan las chicas
//      (las ventas en dólares se pasan a pesos a COTIZACION_USD).
//   3. Transferencias: movimientos de la recaudadora (pestaña recaudadora_movs, la llena
//      scripts/recaudadora-sync.mjs) que NO están en el Excel de comprobantes — las que sí
//      están son ventas de la tienda online. Las de $1M o más se descartan (mayorista).

const MAYORISTA_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const LOCAL_TAB = 'local_ventas';
const RECAUDADORA_TAB = 'recaudadora_movs';
const EFECTIVO_ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const COMPROBANTES_ID = '1UpKb4hhNDZFrNoxH2kIIBXIWBnHStHVflHJ1RKrvXYo';
const TOPE_TRANSFERENCIA_LOCAL = 1_000_000;
const COTIZACION_USD = 1600;

type Sum = { orders: number; amount: number };
const DAY = 864e5;

async function ensureTab(sheets: ReturnType<typeof google.sheets>) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAYORISTA_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === LOCAL_TAB);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: MAYORISTA_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: LOCAL_TAB } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: MAYORISTA_ID,
    range: `'${LOCAL_TAB}'!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['Fecha', 'Monto', 'Método']] },
  });
}

export async function addLocalVenta(monto: number, metodo: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  await ensureTab(sheets);
  await sheets.spreadsheets.values.append({
    spreadsheetId: MAYORISTA_ID,
    range: `'${LOCAL_TAB}'!A:C`,
    valueInputOption: 'RAW',
    requestBody: { values: [[new Date().toISOString(), monto, metodo]] },
  });
}

// Días desde epoch (UTC) de una fecha calendario — para comparar fechas sin horas.
const dayNum = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;

// Fecha de la planilla de efectivo: serial de Sheets (46298) o texto tipo "02/10/2026",
// tolerando typos como "02/010/2026".
function parseFechaEfectivo(v: unknown): number | null {
  if (typeof v === 'number' && v > 40000) return v - 25569; // serial Sheets → días epoch
  const m = String(v ?? '').match(/^(\d{1,2})\/(\d{1,3})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return dayNum(y, mo, d);
}

// Las chicas ponen la fecha solo en la primera fila de cada día: se arrastra hacia abajo.
// Una fecha que retrocede o salta más de un mes se toma como typo y se ignora.
async function getEfectivo(sheets: ReturnType<typeof google.sheets>, desde: number, hasta: number): Promise<Sum> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: EFECTIVO_ID,
    range: `'Movimientos'!A4:H`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  let fecha: number | null = null;
  const out = { orders: 0, amount: 0 };
  for (const [f, , categoria, , ingreso, egreso, , usd] of res.data.values ?? []) {
    const nueva = parseFechaEfectivo(f);
    if (nueva !== null && (fecha === null || (nueva >= fecha && nueva - fecha <= 31))) fecha = nueva;
    if (fecha === null || fecha < desde || fecha >= hasta) continue;
    if (categoria !== 'Ventas mostrador') continue;
    // Venta en dólares: se cobra en USD (col H) y a veces se da vuelto en pesos (col Egreso).
    const dolares = Number(usd) || 0;
    const monto = (Number(ingreso) || 0) + (dolares > 0 ? dolares * COTIZACION_USD - (Number(egreso) || 0) : 0);
    if (monto <= 0) continue;
    out.orders++;
    out.amount += monto;
  }
  return out;
}

// "$54.862,69" / "$43.922" / "$262,940.000" → número
function parseImporte(raw: string) {
  let s = String(raw ?? '').replace(/[$\s]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  return Number(s) || 0;
}

function palabras(nombre: string) {
  return new Set(
    nombre
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}
const enComun = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

async function getTransferenciasLocal(sheets: ReturnType<typeof google.sheets>, desde: number, hasta: number) {
  const [movRes, compRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: MAYORISTA_ID,
      range: `'${RECAUDADORA_TAB}'!A2:D`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({ spreadsheetId: COMPROBANTES_ID, range: `'Datos Manychat'!A2:L` }),
  ]);

  // Fecha AR del movimiento ("2026-10-03T20:08:01-03:00" → día).
  const movs = (movRes.data.values ?? []).map(([id, iso, nombre, importe]) => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return { id, iso: String(iso), dia: dayNum(y, m, d), nombre: palabras(String(nombre ?? '')), importe: Number(importe) || 0 };
  });
  const enMes = movs.filter((m) => m.dia >= desde && m.dia < hasta).sort((a, b) => a.iso.localeCompare(b.iso));

  // Comprobantes de unos días antes del mes también, por pagos que impactan al día siguiente.
  const comps = (compRes.data.values ?? [])
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r[0])))
    .map((r) => {
      const [y, m, d] = String(r[0]).split('-').map(Number);
      return { dia: dayNum(y, m, d), importe: parseImporte(r[2]), nombre: palabras(String(r[11] ?? '')), usado: false };
    })
    .filter((c) => c.dia >= desde - 3 && c.dia < hasta + 2);

  // 1ª pasada: mismo importe (±$1) y ±1 día. 2ª: mismo nombre (2+ palabras) y ±2 días,
  // para pagos que no coinciden en monto con el comprobante (pagó de más/menos).
  let pendientes = enMes.filter((m) => {
    const c = comps.find((c) => !c.usado && Math.abs(c.importe - m.importe) <= 1 && Math.abs(c.dia - m.dia) <= 1);
    if (c) c.usado = true;
    return !c;
  });
  pendientes = pendientes.filter((m) => {
    const c = comps.find((c) => !c.usado && Math.abs(c.dia - m.dia) <= 2 && enComun(c.nombre, m.nombre) >= 2);
    if (c) c.usado = true;
    return !c;
  });

  const local = pendientes.filter((m) => m.importe < TOPE_TRANSFERENCIA_LOCAL);
  const ultimo = movs.reduce((max, m) => (m.iso > max ? m.iso : max), '');
  return {
    orders: local.length,
    amount: local.reduce((s, m) => s + m.importe, 0),
    actualizadoHasta: ultimo || null,
  };
}

export async function getLocalVentasSummary(year: number, month: number) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const desde = dayNum(year, month, 1);
  const hasta = dayNum(year, month + 1, 1);
  const mpFrom = new Date(Date.UTC(year, month - 1, 1, 3)).toISOString();
  const mpTo = new Date(Math.min(Date.now(), Date.UTC(year, month, 1, 3))).toISOString();

  const [mp, efectivo, transferencias] = await Promise.all([
    getMercadoPagoLocalSummary(mpFrom, mpTo),
    getEfectivo(sheets, desde, hasta),
    getTransferenciasLocal(sheets, desde, hasta),
  ]);

  return {
    orders: mp.orders + efectivo.orders + transferencias.orders,
    amount: mp.amount + efectivo.amount + transferencias.amount,
    mp,
    efectivo,
    transferencias,
  };
}
