// Carga única del histórico mensual de Tienda Online y Local (Empretienda) desde las órdenes del panel, para los meses
// que Métricas ya no da completos (con fechas explícitas corta en 1.500 ventas). De ahí en adelante el mes en curso lo
// guarda scripts/empretienda-metricas.mjs en cada lectura.
//
// Uso (con un perfil de Chrome logueado en Empretienda, p. ej. una copia de ~/tildar_profile):
//   node scripts/historico-empretienda.mjs <perfil> 2026-05 2026-09
// Usa la consulta de Métricas (solo pagadas, filtrada por fecha, de a 750) mes por mes: el listado completo de órdenes
// trae todos los intentos de pago fallidos y las páginas viejas no cargan. Local = payment.method 3 (Acordar).
// Monto = order.total. Escribe historico_mensual con la cuenta de servicio de ~/.claude/.mateando-credentials.json.
import { chromium } from 'playwright';
import { homedir } from 'os';
import { google } from 'googleapis';

const [perfil, desdeMes, hastaMes] = process.argv.slice(2);
if (!perfil || !/^\d{4}-\d{2}$/.test(desdeMes ?? '') || !/^\d{4}-\d{2}$/.test(hastaMes ?? '')) {
  console.log('Uso: node scripts/historico-empretienda.mjs <perfil> <desde YYYY-MM> <hasta YYYY-MM>');
  process.exit(1);
}
const ORDENES = 'https://dashboard.empretienda.ar.ua.la/1/orders';
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const HIST = 'historico_mensual';
const RASTREO = /amplitude\.com|braze\.com|d22fxaf9t8d39k\.cloudfront\.net|googletagmanager|google-analytics|analytics\.google|doubleclick|ccm\/collect/;

const ctx = await chromium.launchPersistentContext(perfil, { headless: true });
await ctx.route(RASTREO, (r) => r.abort());
const page = await ctx.newPage();
let auth;
page.on('request', (r) => { if (r.url().includes('ar.ua.la/1/orders') && r.headers().authorization) auth = r.headers().authorization; });
await page.goto('https://panel.empretienda.com/listado-de-ventas', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40 && !auth; i++) await page.waitForTimeout(1000);
if (!auth) throw new Error('No conseguí el token del panel (¿sesión vencida?)');

const meses = new Map(); // `${mes}|${canal}` → { monto, ventas }
// Misma consulta que usa Métricas: solo pagadas (payment_status=1) y filtrada por fecha, de a 750, mes por mes.
const lista = [];
for (let d = new Date(`${desdeMes}-01T12:00:00Z`); d.toISOString().slice(0, 7) <= hastaMes; d.setUTCMonth(d.getUTCMonth() + 1)) lista.push(d.toISOString().slice(0, 7));
for (const mes of lista) {
  const [y, m] = mes.split('-').map(Number);
  const from = new Date(`${mes}-01T00:00:00-03:00`).toISOString();
  const until = new Date(new Date(`${y}-${String(m + 1 > 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00-03:00`.replace(/^\d{4}/, String(m === 12 ? y + 1 : y))).getTime() - 1).toISOString();
  const vistas = new Set();
  for (let p = 0; p < 40; p++) {
    let lote;
    for (let i = 1; ; i++) {
      const r = await page.request.get(`${ORDENES}?payment_status=1&from=${from}&until=${until}&page=${p}&limit=750`, { headers: { authorization: auth, accept: 'application/json' }, timeout: 120000 }).catch(() => null);
      if (r?.ok()) { lote = await r.json(); break; }
      if (i === 5) throw new Error(`No pude leer ${mes} página ${p}`);
      await page.waitForTimeout(5000 * i);
    }
    const arr = Array.isArray(lote) ? lote : lote.data ?? [];
    for (const o of arr) {
      if (vistas.has(o.id) || String(o.payment?.status) !== '1') continue;
      vistas.add(o.id);
      const canal = String(o.payment?.method) === '3' ? 'local' : 'online';
      const k = `${mes}|${canal}`;
      const x = meses.get(k) ?? { monto: 0, ventas: 0 };
      x.monto += Number(o.total) || 0;
      x.ventas += 1;
      meses.set(k, x);
    }
    if (arr.length < 750) break;
  }
  console.log(`${mes}: ${vistas.size} órdenes pagadas`);
}
await ctx.close();

const ahora = new Date().toISOString();
const nuevas = [...meses].map(([k, v]) => {
  const [mes, canal] = k.split('|');
  return [mes, canal, Math.round(v.monto), v.ventas, 'Órdenes del panel de Empretienda (carga única)', ahora];
});
for (const f of nuevas.sort()) console.log(f.slice(0, 4).join(' | '));

const auth2 = new google.auth.GoogleAuth({ keyFile: `${homedir()}/.claude/.mateando-credentials.json`, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: auth2 });
const titulos = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' })).data.sheets.map((x) => x.properties?.title);
if (!titulos.includes(HIST)) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: HIST } } }] } });
const claves = new Set(nuevas.map((f) => `${f[0]}|${f[1]}`));
const previas = ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? []).filter((r) => !claves.has(`${r[0]}|${r[1]}`));
const todas = [...previas, ...nuevas].sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A:F` });
await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['mes', 'canal', 'monto', 'ventas', 'fuente', 'actualizado'], ...todas] } });
console.log(`historico_mensual: ${nuevas.length} filas de Empretienda guardadas`);
