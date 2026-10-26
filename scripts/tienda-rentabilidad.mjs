// Rentabilidad de la tienda de Empretienda por venta, como scripts/meli-rentabilidad.mjs para Mercado Libre.
// Lee la pestaña emp_ventas (la llena scripts/empretienda-ordenes.mjs cada 30 min) y escribe rentabilidad_tienda
// (una fila por venta) y rentabilidad_tienda_ads (pauta de Meta y Google por día) en MATEANDO MAYORISTA 2026.
//   - Venta: subtotal − cupón − descuento por medio de pago. Se le saca el IVA solo a lo que se factura (Mercado Pago,
//     GoCuotas y lo cobrado en el local); las transferencias no se facturan y entran enteras (Juampi, 25-oct-2026).
//     El envío que paga el comprador se lo lleva OCA.
//   - Envío de la tienda: lo que cuesta el envío gratis (Empretienda lo cotiza con la cuenta de OCA), sin IVA.
//   - Comisión: Mercado Pago, la real de cada pago (comisión + costo de cuotas sin interés), sin IVA.
//     GoCuotas: 7,9% + IVA sobre lo cobrado (con el envío), a 22 días hábiles (condiciones de la cuenta, 25-oct-2026).
//     Transferencia: 3% de lo transferido, que cobra la financiera.
//   - Impuestos de lo facturado: IIBB 5% de la venta sin IVA e impuesto a los débitos y créditos 1,2% de lo cobrado
//     (con IVA y envío). Las transferencias no se facturan: solo pagan el 3% de la financiera (Juampi, 25-oct-2026).
//   - Costo de producto y packaging: reglas de scripts/cmv (las mismas del CMV de /canales), venta por venta.
// Solo cuentan las ventas pagadas. canal = local si se pagó "a acordar" (retiro en el local).
//   node scripts/tienda-rentabilidad.mjs               → 60 días a las 6 de la mañana, 10 días el resto de las horas
//   node scripts/tienda-rentabilidad.mjs --dias 30
//   node scripts/tienda-rentabilidad.mjs --cargar ordenes.json   → primero vuelca a emp_ventas órdenes crudas bajadas a mano
import { execFileSync } from 'child_process';
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { google } from 'googleapis';
import { venta as filaVenta, VENTAS_COLS } from './empretienda-ordenes.mjs';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
const TAB = 'rentabilidad_tienda';
const TAB_ADS = 'rentabilidad_tienda_ads';
const IVA = 1.21;
const IIBB = 0.05; // sobre la venta facturada sin IVA
const DEB_CRED = 0.012; // impuesto a los débitos y créditos, sobre lo cobrado facturado
// Lo que se factura. El local ("a acordar") se cuenta como facturado: Empretienda no dice si se cobró con MP o en efectivo.
const FACTURADAS = new Set(['mercadopago', 'gocuotas', 'acordar']);
const FINANCIERA_TASA = 0.03; // transferencias
const GOCUOTAS_TASA = 0.079; // + IVA, sobre el total cobrado
const PAGO = { 1: 'mercadopago', 3: 'acordar', 5: 'transferencia', 8: 'gocuotas' };
// Pauta que va contra la tienda online (ver /canales): Meta MATEANDO2 (+8% de comisiones) y MATEANDO 3 MP, y Google Ads.
const META_RECARGO = { act_1439554678210755: 1.08 };
const GOOGLE_ADS_CLIENTE = '5346606046';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const horaAR = new Date(Date.now() - 3 * 3600e3).getUTCHours();
const DIAS = Number(arg('--dias') ?? (horaAR === 6 ? 60 : 10));
const leerEnv = (archivo) =>
  Object.fromEntries(readFileSync(join(homedir(), '.claude', archivo), 'utf8').split('\n').filter((l) => /^\w+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const auth = new google.auth.GoogleAuth({
  keyFile: `${homedir()}/.claude/.mateando-credentials.json`,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

const diaAR = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const r2 = (n) => Math.round(n * 100) / 100;
async function enLotes(lista, n, fn) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(...(await Promise.all(lista.slice(i, i + n).map(fn))));
  return out;
}

// Reemplaza en la pestaña las filas de los días recalculados y deja el resto (igual que meli-rentabilidad.mjs).
async function guardar(tab, encabezado, filasNuevas, desde, hasta, columnaFecha = 0) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const hoja = meta.data.sheets.find((s) => s.properties?.title === tab);
  if (!hoja) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
  const prev = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A2:Z`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const fecha = (r) => String(r[columnaFecha]);
  const filas = [...prev.filter((r) => fecha(r) < desde || fecha(r) > hasta), ...filasNuevas].sort((a, b) => fecha(b).localeCompare(fecha(a)));
  await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [encabezado, ...filas] } });
  const total = hoja?.properties?.gridProperties?.rowCount ?? 0;
  if (total > filas.length + 1) await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A${filas.length + 2}:Z${total}` });
  return filas.length;
}

// --cargar: órdenes crudas del panel (lista de JSON) → emp_ventas, sin datos personales (mismo formato que el volcado).
if (arg('--cargar')) {
  // Solo agrega las órdenes que faltan: las que ya están las escribió la lectura automática y son más nuevas.
  const crudas = JSON.parse(readFileSync(arg('--cargar'), 'utf8'));
  const prev = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'emp_ventas'!A2:Q`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
  const ya = new Set(prev.map((r) => String(r[0])));
  const nuevas = crudas.map(filaVenta).filter((v) => !ya.has(String(v[0])));
  const n = await guardar('emp_ventas', VENTAS_COLS, [...prev, ...nuevas], '0000', '9999', 2);
  console.log(`emp_ventas: ${nuevas.length} órdenes agregadas, ${n} en total`);
}

// Costo por SKU: los mismos tres niveles que el CMV de /canales (scripts/cmv/README.md).
async function costosSku() {
  const costos = JSON.parse(readFileSync(new URL('./cmv/costos_base.json', import.meta.url), 'utf8'));
  const hojas = (await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP })).data.sheets.map((h) => h.properties.title);
  for (const h of hojas.filter((h) => !['BASE scalify', 'Hoja 22'].includes(h))) {
    const filas = (await sheets.spreadsheets.values.get({ spreadsheetId: COSTOS_JP, range: `'${h}'!F2:G400` })).data.values ?? [];
    for (const [sku, c] of filas) {
      const n = Number(String(c ?? '').replace(/[$\s.]/g, '').replace(',', '.'));
      if (sku?.trim() && c && n > 0) costos[sku.trim()] = n;
    }
  }
  const override = JSON.parse(readFileSync(new URL('./cmv/costos_override.json', import.meta.url), 'utf8'));
  for (const [k, v] of Object.entries(override)) if (!k.startsWith('_')) costos[k] = v;
  return costos;
}

// Comisión real de Mercado Pago de un pago: comisión + financiación de cuotas sin interés.
const MP = leerEnv('.mercadopago').MERCADOPAGO_ACCESS_TOKEN;
async function comisionMP(id) {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${MP}` } }).catch(() => null);
    if (r?.ok) {
      const p = await r.json();
      return { comision: (p.fee_details ?? []).reduce((s, f) => s + (f.amount || 0), 0), cuotas: p.installments ?? 1 };
    }
    if (r && r.status === 404) return null;
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return null;
}

// Pauta por día de Meta (cuentas de la tienda online) y Google Ads.
async function pautaPorDia(desde, hasta) {
  const dias = new Map();
  const sumar = (fecha, k, v) => dias.set(fecha, { meta: 0, google: 0, ...dias.get(fecha), [k]: (dias.get(fecha)?.[k] ?? 0) + v });
  const meta = leerEnv('.meta-ads');
  for (const cuenta of meta.META_AD_ACCOUNTS.split(',').map((c) => c.trim()).filter(Boolean)) {
    let url = `https://graph.facebook.com/v21.0/${cuenta}/insights?fields=spend&time_increment=1&limit=100&time_range=${encodeURIComponent(JSON.stringify({ since: desde, until: hasta }))}&access_token=${meta.META_ADS_TOKEN}`;
    while (url) {
      const j = await fetch(url).then((r) => r.json());
      if (j.error) throw new Error(`Meta ${cuenta}: ${j.error.message}`);
      for (const d of j.data ?? []) sumar(d.date_start, 'meta', Number(d.spend || 0) * (META_RECARGO[cuenta] ?? 1));
      url = j.paging?.next ?? null;
    }
  }
  const oauth = JSON.parse(readFileSync(join(homedir(), '.claude', '.mateando-oauth.json'), 'utf8')).installed;
  const refresh = JSON.parse(readFileSync(join(homedir(), '.claude', '.mateando-gads-token.json'), 'utf8')).refresh_token;
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: oauth.client_id, client_secret: oauth.client_secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }).then((r) => r.json());
  const g = await fetch(`https://googleads.googleapis.com/v25/customers/${GOOGLE_ADS_CLIENTE}/googleAds:search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '${desde}' AND '${hasta}'` }),
  }).then((r) => r.json());
  if (g.error) throw new Error(`Google Ads: ${g.error.message}`);
  for (const f of g.results ?? []) sumar(f.segments.date, 'google', Number(f.metrics.costMicros || 0) / 1e6);
  return [...dias.entries()].map(([fecha, v]) => [fecha, r2(v.meta), r2(v.google), r2(v.meta + v.google)]);
}

const hasta = diaAR(new Date().toISOString());
const d0 = new Date(`${hasta}T12:00:00Z`);
d0.setUTCDate(d0.getUTCDate() - (DIAS - 1));
let desde = d0.toISOString().slice(0, 10);

const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'emp_ventas'!A1:Q`, valueRenderOption: 'UNFORMATTED_VALUE' });
const [enc, ...crudas] = res.data.values ?? [];
// emp_ventas guarda ~60 días: no recalcular (ni borrar de rentabilidad_tienda) días que ya no tiene.
const primerDia = crudas.reduce((m, r) => (diaAR(r[2]) < m ? diaAR(r[2]) : m), '9999-12-31');
if (primerDia > desde) desde = primerDia;
const col = Object.fromEntries(enc.map((k, i) => [k, i]));
const ventas = crudas
  .map((r) => Object.fromEntries(Object.keys(col).map((k) => [k, r[col[k]] ?? ''])))
  .filter((v) => Number(v.pago_estado) === 1 && diaAR(v.fecha) >= desde && diaAR(v.fecha) <= hasta);

// CMV y packaging por venta con las reglas de scripts/cmv.
const costos = await costosSku();
const archivoCostos = join(tmpdir(), `costos-tienda-${process.pid}.json`);
writeFileSync(archivoCostos, JSON.stringify(costos));
const entrada = ventas.map((v) => ({ id: String(v.order_id), local: Number(v.pago_metodo) === 3, productos: JSON.parse(v.productos || '[]') }));
const cmv = new Map(
  JSON.parse(execFileSync('python3', [new URL('./cmv/cmv_orden.py', import.meta.url).pathname, archivoCostos], { input: JSON.stringify(entrada), encoding: 'utf8', maxBuffer: 64 << 20 }))
    .map((c) => [c.id, c]),
);
rmSync(archivoCostos, { force: true });

const pagosMP = new Map(await enLotes(ventas.filter((v) => v.mp_pago_id), 10, async (v) => [String(v.order_id), await comisionMP(v.mp_pago_id)]));

const filas = ventas.map((v) => {
  const metodo = PAGO[Number(v.pago_metodo)] ?? 'otro';
  const ventaIva = Number(v.subtotal) - Number(v.cupon) - Number(v.desc_pago);
  const mp = pagosMP.get(String(v.order_id));
  const cobrado = ventaIva + Number(v.envio_cobrado);
  const comisionIva = metodo === 'mercadopago' ? (mp?.comision ?? 0) : metodo === 'gocuotas' ? cobrado * GOCUOTAS_TASA * IVA : 0;
  const sinComision = metodo === 'mercadopago' && !mp ? 1 : 0;
  const c = cmv.get(String(v.order_id)) ?? { cmv: 0, empaque: 0, despacho: 0, sin_costo: 0, sin_regla: [] };
  const facturada = FACTURADAS.has(metodo);
  const neto = (x) => (facturada ? x / IVA : x);
  const ventaSinIva = neto(ventaIva);
  // La de la financiera no lleva IVA: se resta tal cual.
  const comision = comisionIva / IVA + (metodo === 'transferencia' ? cobrado * FINANCIERA_TASA : 0);
  const envioTienda = Number(v.envio_gratis || 0) / IVA;
  const impuestos = facturada ? ventaSinIva * IIBB : 0;
  const debCred = facturada ? cobrado * DEB_CRED : 0;
  const packaging = c.empaque + c.despacho;
  const productos = JSON.parse(v.productos || '[]');
  return [
    diaAR(v.fecha), String(v.order_id), String(v.numero), Number(v.pago_metodo) === 3 ? 'local' : 'online', metodo, String(v.envio),
    String(v.cp), String(v.provincia), String(v.ciudad), productos.reduce((s, p) => s + (p.q || 0), 0),
    r2(ventaSinIva), r2(neto(Number(v.cupon) + Number(v.desc_pago))), r2(neto(Number(v.envio_cobrado))), r2(comision), r2(envioTienda),
    r2(impuestos), r2(c.cmv), r2(packaging), r2(ventaSinIva - comision - envioTienda - impuestos - debCred - c.cmv - packaging),
    c.sin_costo, sinComision, mp?.cuotas ?? '', String(v.fecha), JSON.stringify(productos.map((p) => ({ id: p.id, n: p.n, v: p.v, q: p.q, p: p.p }))),
    r2(debCred), facturada ? 1 : 0,
  ];
});
const COLS = ['fecha', 'order_id', 'numero', 'canal', 'pago', 'envio', 'cp', 'provincia', 'ciudad', 'unidades', 'venta', 'descuentos',
  'envio_cobrado', 'comision', 'envio_tienda', 'impuestos', 'costo', 'packaging', 'neto', 'sin_costo', 'sin_comision', 'cuotas', 'creada', 'productos', 'deb_cred', 'facturada'];

const ads = await pautaPorDia(desde, hasta);
const suma = (i) => Math.round(filas.reduce((s, f) => s + f[i], 0)).toLocaleString('es-AR');
console.log(`${desde} a ${hasta}: ${filas.length} ventas · venta ${suma(10)} · neto ${suma(18)} · pauta ${Math.round(ads.reduce((s, a) => s + a[3], 0)).toLocaleString('es-AR')}`);
if (args.includes('--dry')) process.exit(0);
const n = await guardar(TAB, [...COLS, new Date().toISOString()], filas, desde, hasta);
await guardar(TAB_ADS, ['fecha', 'meta', 'google', 'total', new Date().toISOString()], ads, desde, hasta);
console.log(`${TAB}: ${n} filas en total`);
