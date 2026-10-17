// Métricas del mes de Empretienda → Google Sheet (pestaña dashboard_manual, fila 5).
//
// Lo llama mateandobot (`empretienda_metricas.py`, con la sesión de Empretienda del bot) con
// los números que leyó en panel.empretienda.com/metricas: total del mes y método "Acordar".
// El dashboard toma Acordar = Local Físico y Total − Acordar = Tienda Online.
//
// Uso:
//   node scripts/empretienda-sync.mjs '{"mes":"2026-10","totalMonto":1,"totalCant":1,"acordarMonto":1,"acordarCant":1}'

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const RANGE = "'dashboard_manual'!A5:F5";

const d = JSON.parse(process.argv[2]);
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(readFileSync(join(homedir(), '.claude/.mateando-credentials.json'), 'utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values: [[d.mes, d.totalMonto, d.totalCant, d.acordarMonto, d.acordarCant, new Date().toISOString()]] },
});
console.log('Empretienda métricas →', d);
