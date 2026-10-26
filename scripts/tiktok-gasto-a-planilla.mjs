// Gasto diario de TikTok Ads desde Escalafy → pestaña tiktok_gasto de la planilla mayorista (fecha | gasto ARS |
// actualizado), que lee /api/tiktok mientras la app propia de TikTok no esté aprobada. Escalafy conecta la cuenta
// ANDOMAT 611 SRL; el panel no puede leer Escalafy directo, así que una tarea programada de Claude baja
// get_dashboard_report (metrics ["tiktok_ad_spend"], include_daily_rows, currency ARS) y corre:
//   node scripts/tiktok-gasto-a-planilla.mjs respuesta.json
// Reemplaza los días que trae (los últimos días se recalculan: las plataformas corrigen) y deja los demás.
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'tiktok_gasto';

const rep = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (rep.currency && rep.currency !== 'ARS') throw new Error(`El reporte vino en ${rep.currency}, tiene que ser ARS`);
const dias = (rep.rows ?? []).map((r) => [r.date, Math.round(Number(r.metrics?.tiktok_ad_spend) || 0)]);
if (!dias.length) throw new Error('El reporte no trae filas diarias (falta include_daily_rows)');

const auth = new google.auth.GoogleAuth({ keyFile: `${homedir()}/.claude/.mateando-credentials.json`, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const titulos = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' })).data.sheets.map((x) => x.properties?.title);
if (!titulos.includes(TAB)) await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
const nuevos = new Set(dias.map((d) => d[0]));
const previas = ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:C`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? []).filter((r) => !nuevos.has(String(r[0])));
const ahora = new Date().toISOString();
const todas = [...previas, ...dias.map(([f, g]) => [f, g, ahora])].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:C` });
await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['fecha', 'gasto', 'actualizado'], ...todas] } });
const total = dias.reduce((s, d) => s + d[1], 0);
console.log(`tiktok_gasto: ${dias.length} días (${dias[0][0]} a ${dias.at(-1)[0]}), gasto total $${total.toLocaleString('es-AR')}`);
