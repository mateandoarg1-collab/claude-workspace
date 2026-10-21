// Costos de Meli por publicación (MLA) y variante → pestaña costos_meli de la planilla MATEANDO MAYORISTA 2026,
// que usa /api/ml/periodo para el CMV de Mercado Libre.
// Los costos los carga JP en Escalafy (ya incluyen bombilla y packaging). El panel no puede leer Escalafy directo:
// una tarea programada de Claude baja get_product_costs (platform mercadolibre) con el conector y corre:
//   node scripts/costos-meli-a-planilla.mjs pagina1.json [pagina2.json ...]
// Cada JSON es la respuesta tal cual de get_product_costs ({ items: [...] }).
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'costos_meli';

const items = process.argv.slice(2).flatMap((f) => JSON.parse(readFileSync(f, 'utf8')).items ?? []);
const filas = items
  .filter((i) => i.platform === 'mercadolibre' && i.unit_cost != null && i.cost_type)
  .map((i) => [i.product_id, i.variant_id ?? '', i.cost_type, i.unit_cost, i.product_name ?? '']);
if (!filas.length) throw new Error('No vino ningún costo de Meli');

const auth = new google.auth.GoogleAuth({
  keyFile: `${homedir()}/.claude/.mateando-credentials.json`,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (!meta.data.sheets.some((s) => s.properties?.title === TAB)) {
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
}
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:F` });
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${TAB}'!A1`,
  valueInputOption: 'RAW',
  requestBody: { values: [['item_id', 'variant_id', 'tipo', 'costo', 'nombre', new Date().toISOString()], ...filas] },
});
console.log(`costos_meli: ${filas.length} costos de ${items.length} publicaciones/variantes`);
