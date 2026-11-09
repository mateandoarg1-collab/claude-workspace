// Rentabilidad de la caja del local (mateando-local.vercel.app), venta por venta → pestaña "Rentabilidad Local" de la
// planilla de efectivo del local. La lee /api/local-metricas (solapa Métricas, con clave). Corre en DonWeb después
// de tienda-rentabilidad.mjs (scripts/servidor/tienda-rentabilidad.sh, cada hora).
//   - Costo de producto: mismas reglas que el CMV de /canales y la rentabilidad de la tienda (scripts/cmv/cmv_orden.py
//     con local=true → una bolsa PACK-BOL-11001 por pedido, sin caja de despacho). En el local TODOS los pedidos llevan
//     bolsa (Juampi, 9-nov-2026). Costos a mano por producto: pestaña costos_tienda (nombre → costo sin IVA); los
//     productos que solo existen en el local se cargan ahí con su nombre tal cual.
//   - Tarjeta / QR (Débito, Crédito, QR MP): se factura → IVA, IIBB 5% de lo neto, débitos y créditos 1,2%, y la
//     comisión real del pago de Mercado Pago unido a la venta (si no se encontró el pago, la comisión promedio).
//   - Transferencia: 3,25% de la financiera, sin factura. Efectivo, USD y EUR: nada.
//   node scripts/local-rentabilidad.mjs
import { execFileSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { google } from 'googleapis';

const EFECTIVO = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const MAYORISTA = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
const TAB = 'Rentabilidad Local';
const IVA = 1.21, IIBB = 0.05, DEB_CRED = 0.012, FINANCIERA = 0.0325;
const FACTURA = new Set(['Débito', 'Crédito', 'QR MP']);

const CLAVES = process.env.MATEANDO_CLAVES ?? join(homedir(), '.claude');
const leerEnv = (archivo) =>
  Object.fromEntries(readFileSync(join(CLAVES, archivo), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const auth = new google.auth.GoogleAuth({ keyFile: join(CLAVES, '.mateando-credentials.json'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const r2 = (n) => Math.round(n * 100) / 100;
const get = async (id, range) => (await sheets.spreadsheets.values.get({ spreadsheetId: id, range, valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null))?.data.values ?? [];

// Costos por SKU (igual que tienda-rentabilidad.mjs): base → override → planilla Costos JP (manda) + a mano por producto.
async function costosSku() {
  const costos = JSON.parse(readFileSync(new URL('./cmv/costos_base.json', import.meta.url), 'utf8'));
  const override = JSON.parse(readFileSync(new URL('./cmv/costos_override.json', import.meta.url), 'utf8'));
  for (const [k, v] of Object.entries(override)) if (!k.startsWith('_')) costos[k] = v;
  const hojas = (await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP })).data.sheets.map((h) => h.properties.title);
  for (const h of hojas.filter((h) => !['BASE scalify', 'Hoja 22'].includes(h))) {
    const filas = (await sheets.spreadsheets.values.get({ spreadsheetId: COSTOS_JP, range: `'${h}'!F2:G400` })).data.values ?? []; // con formato: "$ 12.345"
    for (const [sku, c] of filas) {
      const n = Number(String(c ?? '').replace(/[$\s.]/g, '').replace(',', '.'));
      if (String(sku ?? '').trim() && c && n > 0) costos[String(sku).trim()] = n;
    }
  }
  costos._productos = Object.fromEntries((await get(MAYORISTA, "'costos_tienda'!A2:B"))
    .filter(([p, c]) => String(p ?? '').trim() && Number(c) >= 0).map(([p, c]) => [String(p).toUpperCase().replace(/\s+/g, ' ').trim(), Number(c)]));
  return costos;
}

// Ventas viejas (antes del 9-nov a la tarde) no guardaban producto y variante: se reconstruyen del nombre
// ("MATE X (c/ bombilla · NEGRO)") con el catálogo de la caja.
let catalogo = null;
async function reconstruir(it) {
  if (it.n || it.local) return { n: it.n || it.nombre.replace(/ \[.*?\]/g, ''), v: it.v || '' };
  catalogo ??= (await fetch('https://claude-workspace-virid.vercel.app/api/local-caja').then((r) => r.json())).productos;
  const m = it.nombre.replace(/ \[.*?\]/g, '').match(/^(.*?)(?: \((.*)\))?$/);
  const p = catalogo.find((x) => x.nombre === m[1]);
  if (!p) return { n: m[1], v: '' };
  const toks = (m[2] ?? '').split(' · ').map((t) => t.trim().toUpperCase()).filter(Boolean);
  const attrs = [...new Set((p.variantes ?? []).flatMap((v) => Object.keys(v.op)))];
  const op = {};
  for (const a of attrs) {
    const vals = [...new Set(p.variantes.map((v) => v.op[a]))];
    const si = toks.some((t) => t.startsWith('C/ ') && t.slice(3) === a.toUpperCase());
    const val = vals.includes('SI') ? (si ? 'SI' : 'NO') : vals.find((x) => toks.includes(String(x).toUpperCase())) ?? '';
    if (val) op[a] = val;
  }
  return { n: p.nombre, v: Object.entries(op).map(([k, x]) => `${k}: ${x}`).join(' | ') };
}

const MP = leerEnv('.mercadopago').MERCADOPAGO_ACCESS_TOKEN;
async function comisionMP(id) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${MP}` } }).catch(() => null);
    if (r?.ok) { const p = await r.json(); return (p.fee_details ?? []).filter((f) => f.fee_payer !== 'payer').reduce((s, f) => s + (f.amount || 0), 0); }
    if (r?.status === 404) return null;
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return null;
}

const filas = (await get(EFECTIVO, "'Ventas Caja'!A2:R")).filter((f) => f[0] && f[14] !== 'anulada');
const ventas = [];
for (const f of filas) {
  let items = []; try { items = JSON.parse(f[15] || '[]'); } catch {}
  let pagos = []; try { pagos = JSON.parse(f[17] || ''); } catch {}
  if (!pagos.length) pagos = [{ medio: f[5], pesos: Number(f[10]) || 0 }];
  const productos = [];
  for (const it of items) { const { n, v } = await reconstruir(it); productos.push({ n, v, q: it.cant, local: !!it.local, nombre: it.nombre }); }
  ventas.push({ nro: Number(f[0]), fecha: f[1], dia: f[2], total: Number(f[10]) || 0, pagos, mp: String(f[16] ?? '').match(/MP (\d+)/)?.[1], productos });
}

// CMV + bolsa con scripts/cmv/cmv_orden.py (local = una bolsa por pedido)
const costos = await costosSku();
const archivo = join(tmpdir(), `costos-local-${process.pid}.json`);
writeFileSync(archivo, JSON.stringify(costos));
let cmv = [];
try {
  const entrada = ventas.map((v) => ({ id: v.nro, local: true, productos: v.productos.map((p) => ({ n: p.n, v: p.v, q: p.q })) }));
  cmv = JSON.parse(execFileSync('python3', [new URL('./cmv/cmv_orden.py', import.meta.url).pathname, archivo], { input: JSON.stringify(entrada), encoding: 'utf8', maxBuffer: 64 << 20 }));
} finally { rmSync(archivo, { force: true }); }
const cmvPor = new Map(cmv.map((c) => [Number(c.id), c]));

// comisión de MP: la real; si no se encontró el pago, el promedio de las encontradas (o 6%)
const comisiones = new Map();
for (const v of ventas) if (v.mp) comisiones.set(v.nro, await comisionMP(v.mp));
const tarjeta = (v) => v.pagos.filter((p) => FACTURA.has(p.medio)).reduce((s, p) => s + p.pesos, 0);
const conMP = ventas.filter((v) => comisiones.get(v.nro) != null && tarjeta(v));
const tasaProm = conMP.length ? conMP.reduce((s, v) => s + comisiones.get(v.nro), 0) / conMP.reduce((s, v) => s + tarjeta(v), 0) : 0.06;

const ahora = new Date().toISOString();
const salida = ventas.map((v) => {
  const c = cmvPor.get(v.nro) ?? { cmv: 0, empaque: 0, sin_costo_n: [], sin_regla: [] };
  const fact = tarjeta(v), transf = v.pagos.filter((p) => p.medio === 'Transferencia').reduce((s, p) => s + p.pesos, 0);
  const comision = fact ? (comisiones.get(v.nro) ?? fact * tasaProm) : 0;
  const iva = fact - fact / IVA, iibb = (fact / IVA) * IIBB, debcred = fact * DEB_CRED, financiera = transf * FINANCIERA;
  const ganancia = v.total - c.cmv - c.empaque - comision - iva - iibb - debcred - financiera;
  const sinCosto = [...new Set([...(c.sin_costo_n ?? []), ...(c.sin_regla ?? [])])].join(' | ');
  return [v.nro, v.fecha, v.dia, v.total, r2(c.cmv), r2(c.empaque), r2(comision), r2(iva), r2(iibb), r2(debcred), r2(financiera), r2(ganancia), sinCosto, ahora];
});
const meta = await sheets.spreadsheets.get({ spreadsheetId: EFECTIVO, fields: 'sheets.properties.title' });
if (!meta.data.sheets.some((s) => s.properties.title === TAB))
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: EFECTIVO, requestBody: { requests: [{ addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } }] } });
await sheets.spreadsheets.values.clear({ spreadsheetId: EFECTIVO, range: `'${TAB}'!A:Z` });
await sheets.spreadsheets.values.update({ spreadsheetId: EFECTIVO, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [
  ['pedido', 'fecha_hora', 'dia', 'venta', 'cmv', 'bolsa_empaque', 'comision_mp', 'iva', 'iibb', 'deb_cred', 'financiera', 'ganancia', 'sin_costo', 'actualizado'], ...salida] } });
console.log(`Rentabilidad local: ${salida.length} ventas, ganancia $${Math.round(salida.reduce((s, f) => s + f[11], 0)).toLocaleString('es-AR')}, sin costo: ${salida.filter((f) => f[12]).length}`);
