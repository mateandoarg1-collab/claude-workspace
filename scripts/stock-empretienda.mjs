// Stock del depósito (/stock): traduce cada venta pagada de Empretienda (Tienda Online y Local) a unidades por SKU
// maestro con las reglas del CMV (scripts/cmv/piezas_orden.py) y las guarda por día en la pestaña stock_salidas_emp
// de la planilla "Costos JP - meli". emp_ventas solo guarda ~60 días: los días más viejos que ya están en la pestaña
// se conservan. Lo que no tiene regla va a stock_revisar_emp (agregar la regla en scripts/cmv/reglas.py).
// Corre cada hora en el servidor de DonWeb (scripts/servidor/tienda-rentabilidad.sh).
import { execFileSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { google } from 'googleapis';

const CLAVES = process.env.MATEANDO_CLAVES ?? join(homedir(), '.claude');
const auth = new google.auth.GoogleAuth({ keyFile: join(CLAVES, '.mateando-credentials.json'), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth });
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const STOCK = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
const diaAR = (s) => new Date(Date.parse(s) - 3 * 3600e3).toISOString().slice(0, 10);

const res = await sheets.spreadsheets.values.get({ spreadsheetId: EMP, range: "'emp_ventas'!A1:R", valueRenderOption: 'UNFORMATTED_VALUE' });
const [enc, ...crudas] = res.data.values ?? [];
const col = Object.fromEntries(enc.map((k, i) => [k, i]));
const ventas = crudas
  .filter((r) => Number(r[col.pago_estado]) === 1)
  .map((r) => ({ id: String(r[col.order_id]), dia: diaAR(r[col.fecha]), local: Number(r[col.pago_metodo]) === 3, productos: JSON.parse(r[col.productos] || '[]') }));
const primerDia = ventas.reduce((m, v) => (v.dia < m ? v.dia : m), '9999-12-31');

const out = JSON.parse(execFileSync('python3', [new URL('./cmv/piezas_orden.py', import.meta.url).pathname], { input: JSON.stringify(ventas), encoding: 'utf8', maxBuffer: 64 << 20 }));

async function tab(nombre, encabezado) {
  const hojas = (await sheets.spreadsheets.get({ spreadsheetId: STOCK, fields: 'sheets.properties.title' })).data.sheets.map((h) => h.properties.title);
  if (!hojas.includes(nombre)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: STOCK, requestBody: { requests: [{ addSheet: { properties: { title: nombre, gridProperties: { frozenRowCount: 1 } } } }] } });
    await sheets.spreadsheets.values.update({ spreadsheetId: STOCK, range: `'${nombre}'!A1`, valueInputOption: 'RAW', requestBody: { values: [encabezado] } });
  }
}
async function escribir(nombre, encabezado, filas) {
  await sheets.spreadsheets.values.clear({ spreadsheetId: STOCK, range: `'${nombre}'!A:Z` });
  await sheets.spreadsheets.values.update({ spreadsheetId: STOCK, range: `'${nombre}'!A1`, valueInputOption: 'RAW', requestBody: { values: [encabezado, ...filas] } });
}

const TAB = 'stock_salidas_emp';
const ENC = ['dia', 'canal', 'sku', 'cant'];
await tab(TAB, ENC);
const previas = (await sheets.spreadsheets.values.get({ spreadsheetId: STOCK, range: `'${TAB}'!A2:D`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
const viejas = previas.filter((r) => String(r[0]) < primerDia);
await escribir(TAB, ENC, [...viejas, ...out.piezas]);

const TAB_REV = 'stock_revisar_emp';
const ENC_REV = ['canal', 'publicacion', 'variante', 'unidades'];
await tab(TAB_REV, ENC_REV);
await escribir(TAB_REV, ENC_REV, out.revisar.sort((a, b) => b[3] - a[3]));
console.log(`stock_salidas_emp: ${viejas.length} filas viejas + ${out.piezas.length} desde ${primerDia}; sin regla: ${out.revisar.length}`);
