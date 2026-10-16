// Excel de la recaudadora (Cobranza Integral / Lohas) → Google Sheet.
//
// Lee todos los `grid_movimientos_cuenta_usuario*.xlsx` y `movimientos-*.xlsx` (formato nuevo) de ~/Downloads (los mismos que usa
// mateandobot para conciliar) y agrega las "Transferencia entrante" a la pestaña
// `recaudadora_movs` de la planilla MATEANDO MAYORISTA 2026, sin repetir por ID.
// El dashboard (/resumen) cruza esa pestaña contra el Excel de comprobantes: lo que no
// tiene comprobante es venta del local.
//
// Uso:
//   node scripts/recaudadora-sync.mjs          # lo que corre el launchd cada 30 min
//   node scripts/recaudadora-sync.mjs --dry    # muestra en consola, no escribe la planilla

import { readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import ExcelJS from 'exceljs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'recaudadora_movs';
const DIR = join(homedir(), 'Downloads');
const DRY = process.argv.includes('--dry');

// "03/10/2026 20:08:01" → "2026-10-03T20:08:01-03:00"
function toISO(s) {
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}-03:00` : null;
}

async function readMovs() {
  const files = readdirSync(DIR).filter((f) => /^(grid_movimientos_cuenta_usuario|movimientos-).*\.xlsx$/.test(f));
  const movs = new Map();
  for (const f of files) {
    const path = join(DIR, f);
    if (statSync(path).size === 0) continue;
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.readFile(path);
    } catch {
      console.warn(`No se pudo leer ${f}`);
      continue;
    }
    const ws = wb.worksheets[0];
    const head = ws.getRow(1).values.slice(1).map((h) => String(h ?? '').trim());
    if (head.includes('Nombre Contraparte')) {
      // Formato nuevo del home banking (desde 16-oct-2026): CREDITO = transferencia entrante
      const col = (n) => head.indexOf(n);
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const v = row.values.slice(1);
        if (String(v[col('Tipo Transacción')] ?? '').trim().toUpperCase() !== 'CREDITO') return;
        const id = v[col('Idtransacción')] || v[col('ID COELSA')];
        const iso = toISO(v[col('Fecha y hora proceso')]);
        if (!id || !iso) return;
        movs.set(String(id), [String(id), iso, String(v[col('Nombre Contraparte')] ?? '').trim(), Number(v[col('Importe')]) || 0]);
      });
      continue;
    }
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const [id, fecha, , nombre, , importe, tipo, estado] = row.values.slice(1);
      if (tipo !== 'Transferencia entrante' || estado !== 'Ejecutado') return;
      const iso = toISO(fecha);
      if (!id || !iso) return;
      movs.set(String(id), [String(id), iso, String(nombre ?? '').trim(), Number(importe) || 0]);
    });
  }
  return movs;
}

const movs = await readMovs();
console.log(`${new Date().toISOString()} — ${movs.size} transferencias entrantes en los Excel`);

const sheets = google.sheets({
  version: 'v4',
  auth: new google.auth.GoogleAuth({
    keyFile: join(homedir(), '.claude/.mateando-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  }),
});

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (!meta.data.sheets?.some((s) => s.properties?.title === TAB)) {
  if (!DRY) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TAB}'!A1:D1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['ID', 'Fecha', 'Nombre', 'Importe']] },
    });
  }
}

const existing = DRY
  ? []
  : (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:A` })).data.values ?? [];
const seen = new Set(existing.map((r) => String(r[0])));
const nuevos = [...movs.values()].filter((m) => !seen.has(m[0])).sort((a, b) => a[1].localeCompare(b[1]));

if (DRY) {
  console.table(nuevos.slice(-20));
} else if (nuevos.length) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A:D`,
    valueInputOption: 'RAW',
    requestBody: { values: nuevos },
  });
}
console.log(`${nuevos.length} nuevas${DRY ? ' (dry)' : ' agregadas'}`);
