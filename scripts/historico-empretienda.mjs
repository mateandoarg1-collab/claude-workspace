// Carga única del histórico mensual de Tienda Online y Local (Empretienda) desde las órdenes del panel, para los meses
// que Métricas ya no da completos (con fechas explícitas corta en 1.500 ventas). De ahí en adelante el mes en curso lo
// guarda scripts/empretienda-metricas.mjs en cada lectura.
//
// Uso (con un perfil de Chrome logueado en Empretienda, p. ej. una copia de ~/tildar_profile):
//   node scripts/historico-empretienda.mjs <perfil> 2026-05 2026-09
// Cuenta solo órdenes pagadas (payment.status 1). Local = payment.method 3 (Acordar); el resto, Tienda Online.
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
const mesAR = (iso) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 7);
const corte = new Date(`${desdeMes}-01T00:00:00-03:00`).toISOString();

const ctx = await chromium.launchPersistentContext(perfil, { headless: true });
await ctx.route(RASTREO, (r) => r.abort());
const page = await ctx.newPage();
let auth;
page.on('request', (r) => { if (r.url().includes('ar.ua.la/1/orders') && r.headers().authorization) auth = r.headers().authorization; });
await page.goto('https://panel.empretienda.com/listado-de-ventas', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 40 && !auth; i++) await page.waitForTimeout(1000);
if (!auth) throw new Error('No conseguí el token del panel (¿sesión vencida?)');

const meses = new Map(); // `${mes}|${canal}` → { monto, ventas }
const vistas = new Set();
for (const archived of [0, 1]) {
  for (let p = 0; p < 1000; p++) {
    let lote;
    for (let i = 1; ; i++) {
      const r = await page.request.get(`${ORDENES}?page=${p}&limit=100&sort=1&archived=${archived}`, { headers: { authorization: auth, accept: 'application/json' }, timeout: 90000 }).catch(() => null);
      if (r?.ok()) { lote = await r.json(); break; }
      if (i === 4) throw new Error(`No pude leer la página ${p} (archived ${archived})`);
      await page.waitForTimeout(3000 * i);
    }
    for (const o of lote) {
      if (o.created_at < corte || vistas.has(o.id)) continue;
      vistas.add(o.id);
      if (String(o.payment?.status) !== '1') continue;
      const mes = mesAR(o.created_at);
      if (mes > hastaMes) continue;
      const canal = String(o.payment?.method) === '3' ? 'local' : 'online';
      const k = `${mes}|${canal}`;
      const x = meses.get(k) ?? { monto: 0, ventas: 0 };
      x.monto += Number(o.total) || 0;
      x.ventas += 1;
      meses.set(k, x);
    }
    if (p % 20 === 0) console.log(`archived ${archived} · página ${p} · ${vistas.size} órdenes desde ${desdeMes}`);
    if (lote.length < 100 || lote.at(-1).created_at < corte) break;
  }
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
