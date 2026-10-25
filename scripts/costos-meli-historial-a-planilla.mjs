// Costos de Meli que ya no rigen (con su período) → pestaña costos_meli_historial de MATEANDO MAYORISTA 2026.
// scripts/meli-rentabilidad.mjs toma de acá el costo de una venta vieja; si su fecha no cae en ningún período,
// usa el costo actual de la pestaña costos_meli. Así una venta se valora con el costo vigente el día que se hizo,
// igual que Escalafy.
//   node scripts/costos-meli-historial-a-planilla.mjs historial.json costos.json
// historial.json = items de get_product_cost_history (platform mercadolibre) de Escalafy;
// costos.json = items de get_product_costs (para saber a qué publicación pertenece cada variante).
// Incluye los huecos: si la primera versión arranca en una fecha, antes de esa fecha el costo era 0 (sin cargar).
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'costos_meli_historial';

const [historialFile, costosFile] = process.argv.slice(2);
const historial = JSON.parse(readFileSync(historialFile, 'utf8'));
const publicacion = new Map(JSON.parse(readFileSync(costosFile, 'utf8')).map((c) => [c.variant_id, c.product_id]));

const filas = [];
for (const { variant_id, versions } of historial) {
  const item = publicacion.get(variant_id) ?? variant_id;
  const orden = [...versions].sort((a, b) => (a.period_from ?? '').localeCompare(b.period_from ?? ''));
  if (orden[0]?.period_from) filas.push([item, variant_id, '', orden[0].period_from, '', 0]);
  for (const v of orden) {
    if (v.period_to) filas.push([item, variant_id, v.period_from ?? '', v.period_to, v.cost_type ?? '', v.unit_cost ?? 0]);
  }
}

const auth = new google.auth.GoogleAuth({
  keyFile: `${homedir()}/.claude/.mateando-credentials.json`,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (!meta.data.sheets.some((s) => s.properties?.title === TAB)) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
}
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:G` });
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: [['item_id', 'variant_id', 'desde', 'hasta', 'tipo', 'costo', new Date().toISOString()], ...filas] },
});
console.log(`${TAB}: ${filas.length} períodos de ${historial.length} variantes`);
