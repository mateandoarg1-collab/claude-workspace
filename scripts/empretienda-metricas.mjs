// Métricas de Empretienda (hoy / semana / mes) → planilla, sin la Mac: lo corre GitHub Actions
// (.github/workflows/empretienda.yml) cada 30 min. Hace lo mismo que empretienda_metricas.py de
// mateandobot: entra a panel.empretienda.com/metricas, lee total y "Acordar" (= Local) y escribe
// dashboard_manual!A5:G7, que es lo que muestra /canales.
//
// Env: EMPRETIENDA_STATE (sesión ya iniciada, la sube mateandobot desde la Mac cada 6 h: así Empretienda
// no pide el código por mail) y GOOGLE_SERVICE_ACCOUNT_KEY (JSON).
// El repo es público: los logs no muestran montos.

import { chromium } from 'playwright';
import { google } from 'googleapis';

const PANEL = 'https://panel.empretienda.com/metricas';
const ACORDAR = 3;
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const RANGE = "'dashboard_manual'!A5:G7";

// Día AR (YYYY-MM-DD), corrido `dias` hacia atrás.
const diaAR = (dias = 0) => {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - dias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
};
const hoy = diaAR();
const PERIODOS = { hoy, semana: diaAR(6), mes: hoy.slice(0, 8) + '01' };

function numero(texto, etiqueta) {
  const m = texto.match(new RegExp(etiqueta + '\\s*\\n+\\s*\\$?([\\d.]+)'));
  if (!m) throw new Error(`No encontré '${etiqueta}' en Métricas`);
  return Number(m[1].replace(/\./g, ''));
}

async function leer(page, url, esMes) {
  for (let i = 0; ; i++) {
    await page.goto(url, { waitUntil: 'networkidle' });
    // el mes en curso es el filtro por defecto: el panel saca las fechas de la URL
    if (page.url().includes('from=') || esMes) break;
    if (/auth0|login/.test(page.url())) throw new Error('Sesión de Empretienda vencida: prendé la Mac para que mateandobot suba una nueva');
    if (i === 2) throw new Error(`Empretienda no aplicó el filtro: ${url}`);
  }
  await page.getByText('Volumen de ventas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const texto = await page.innerText('body');
  return [numero(texto, 'Volumen de ventas'), numero(texto, 'Cantidad de ventas')];
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  storageState: JSON.parse(process.env.EMPRETIENDA_STATE),
});
const page = await context.newPage();

const ahora = new Date().toISOString();
const values = [];
for (const [periodo, desde] of Object.entries(PERIODOS)) {
  const rango = `from=${desde}&until=${hoy}`;
  const total = await leer(page, `${PANEL}?${rango}`, periodo === 'mes');
  const acordar = await leer(page, `${PANEL}?${rango}&payment_method=${ACORDAR}`, periodo === 'mes');
  values.push([periodo, desde, total[0], total[1], acordar[0], acordar[1], ahora]);
}
await browser.close();

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
await google.sheets({ version: 'v4', auth }).spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values },
});
console.log(`Métricas de Empretienda actualizadas (${values.map((v) => v[0]).join(', ')}) — ${ahora}`);
