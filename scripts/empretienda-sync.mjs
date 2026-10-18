// Métricas de Empretienda → Google Sheet (pestaña dashboard_manual, filas 5-8: hoy, semana, mes, ayer).
//
// Lo llama mateandobot (`empretienda_metricas.py`, con la sesión de Empretienda del bot) con
// los números que leyó en panel.empretienda.com/metricas: total y método "Acordar" por período.
// El dashboard toma Acordar = Local Físico y Total − Acordar = Tienda Online.
//
// Uso:
//   node scripts/empretienda-sync.mjs '{"periodos":{"hoy":{"desde":"2026-10-17","totalMonto":1,"totalCant":1,"acordarMonto":1,"acordarCant":1},...}}'

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const RANGE = "'dashboard_manual'!A5:G8";
const ORDEN = ['hoy', 'semana', 'mes', 'ayer'];

const { periodos } = JSON.parse(process.argv[2]);
const ahora = new Date().toISOString();
const values = ORDEN.map((k) => {
  const p = periodos[k];
  return [k, p.desde, p.totalMonto, p.totalCant, p.acordarMonto, p.acordarCant, ahora];
});

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(readFileSync(join(homedir(), '.claude/.mateando-credentials.json'), 'utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values },
});
console.log('Empretienda métricas →', values);
