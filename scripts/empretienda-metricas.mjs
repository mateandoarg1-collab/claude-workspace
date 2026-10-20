// Métricas de Empretienda (hoy / ayer / semana / mes) → planilla, sin la Mac: lo corre GitHub Actions
// (.github/workflows/empretienda.yml) cada 30 min. Hace lo mismo que empretienda_metricas.py de
// mateandobot: entra a panel.empretienda.com/metricas, lee total y "Acordar" (= Local) y escribe
// dashboard_manual!A5:G8, que es lo que muestra /canales.
//
// Sesión: Empretienda pide un código por mail al entrar desde un navegador nuevo, así que se usa una
// sesión ya iniciada. Hay dos fuentes y se usa la más nueva:
//   - secreto EMPRETIENDA_STATE: la sube mateandobot desde la Mac cada 6 h (respaldo);
//   - .sesion.enc: la guarda este mismo script al terminar (cifrada con EMPRETIENDA_KEY) y el workflow
//     la pasa de una corrida a la siguiente con actions/cache. Así la sesión se renueva sola sin la Mac.
// La sesión vence a las ~10 h aunque se use. Entonces inicia sesión de nuevo con mail y clave: como la
// sesión guardada trae la cookie `did` ("dispositivo recordado", dura 1 año), Empretienda no pide código.
// Env: EMPRETIENDA_STATE, EMPRETIENDA_KEY, EMPRETIENDA_EMAIL, EMPRETIENDA_PASSWORD,
// GOOGLE_SERVICE_ACCOUNT_KEY (JSON).
// El repo es público: los logs no muestran montos.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';
import { google } from 'googleapis';

const SESION_ENC = '.sesion.enc';
const clave = () => {
  if (!process.env.EMPRETIENDA_KEY) throw new Error('Falta el secreto EMPRETIENDA_KEY');
  return createHash('sha256').update(process.env.EMPRETIENDA_KEY).digest();
};

function cifrar(obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(JSON.stringify(obj)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), datos]).toString('base64');
}

function descifrar(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', clave(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString());
}

// La sesión más nueva entre el secreto (Mac) y la guardada por la corrida anterior.
function sesionInicial() {
  const candidatas = [];
  try { candidatas.push({ origen: 'Mac', ...JSON.parse(process.env.EMPRETIENDA_STATE) }); } catch {}
  try { if (existsSync(SESION_ENC)) candidatas.push({ origen: 'corrida anterior', ...descifrar(readFileSync(SESION_ENC, 'utf8')) }); } catch {}
  if (!candidatas.length) throw new Error('No hay sesión de Empretienda guardada');
  candidatas.sort((a, b) => String(b._guardado ?? '').localeCompare(String(a._guardado ?? '')));
  const { origen, _guardado, ...estado } = candidatas[0];
  console.log(`Sesión de Empretienda: ${origen} (${_guardado ?? 'sin fecha'})`);
  return estado;
}

const PANEL = 'https://panel.empretienda.com/metricas';
const ACORDAR = 3;
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const RANGE = "'dashboard_manual'!A5:G8";

// Día AR (YYYY-MM-DD), corrido `dias` hacia atrás.
const diaAR = (dias = 0) => {
  const d = new Date(Date.now() - 3 * 3600 * 1000 - dias * 86400 * 1000);
  return d.toISOString().slice(0, 10);
};
const hoy = diaAR();
// período → [desde, hasta]
const PERIODOS = { hoy: [hoy, hoy], semana: [diaAR(6), hoy], mes: [hoy.slice(0, 8) + '01', hoy], ayer: [diaAR(1), diaAR(1)] };

function numero(texto, etiqueta) {
  const m = texto.match(new RegExp(etiqueta + '\\s*\\n+\\s*\\$?([\\d.]+)'));
  if (!m) throw new Error(`No encontré '${etiqueta}' en Métricas`);
  return Number(m[1].replace(/\./g, ''));
}

async function iniciarSesion(page) {
  if (!process.env.EMPRETIENDA_EMAIL || !process.env.EMPRETIENDA_PASSWORD) {
    throw new Error('Sesión de Empretienda vencida y faltan EMPRETIENDA_EMAIL / EMPRETIENDA_PASSWORD');
  }
  console.log('Sesión vencida: iniciando sesión de nuevo');
  await page.locator('input[name=username]').fill(process.env.EMPRETIENDA_EMAIL);
  await page.locator('input[name=username]').press('Enter');
  try {
    await page.locator('input[type=password]:visible').waitFor({ state: 'visible', timeout: 20000 });
  } catch (e) {
    // diagnóstico sin datos personales (el repo es público): ruta, títulos y botones de la pantalla
    const u = new URL(page.url());
    const vis = await page.evaluate(() =>
      [...document.querySelectorAll('h1,h2,button,[role=alert],.ulp-input-error-message,iframe')]
        .map((el) => (el.tagName === 'IFRAME' ? `iframe:${new URL(el.src || 'about:blank').hostname}` : el.innerText.trim()))
        .filter(Boolean).slice(0, 15));
    console.log(`No apareció la clave. Pantalla: ${u.hostname}${u.pathname} → ${JSON.stringify(vis).replace(/[\w.+-]+@[\w.-]+/g, '<mail>')}`);
    throw e;
  }
  await page.locator('input[type=password]:visible').fill(process.env.EMPRETIENDA_PASSWORD);
  await page.locator('input[type=password]:visible').press('Enter');
  await page.waitForURL((u) => u.hostname === 'panel.empretienda.com' || /mfa/.test(u.href), { timeout: 30000 });
  if (/mfa/.test(page.url())) throw new Error('Empretienda pidió código por mail: prendé la Mac para que mateandobot suba una sesión nueva');
}

async function leer(page, url, esMes) {
  for (let i = 0; ; i++) {
    await page.goto(url, { waitUntil: 'networkidle' });
    if (/auth0|login/.test(page.url())) {
      if (i === 2) throw new Error('No pude iniciar sesión en Empretienda');
      await iniciarSesion(page);
      continue;
    }
    // el mes en curso es el filtro por defecto: el panel saca las fechas de la URL
    if (page.url().includes('from=') || esMes) break;
    if (i === 2) throw new Error(`Empretienda no aplicó el filtro: ${url}`);
  }
  await page.getByText('Volumen de ventas').first().waitFor({ timeout: 30000 });
  // Empretienda va completando los números mientras carga: leer hasta que dos lecturas seguidas coincidan.
  let previo = '';
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(2000);
    const texto = await page.innerText('body');
    const actual = [numero(texto, 'Volumen de ventas'), numero(texto, 'Cantidad de ventas')];
    if (actual.join() === previo) return actual;
    previo = actual.join();
  }
  throw new Error(`Los números de Métricas no se estabilizaron: ${url}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  timezoneId: 'America/Argentina/Buenos_Aires',
  storageState: sesionInicial(),
});
const page = await context.newPage();

const ahora = new Date().toISOString();
const values = [];
for (const [periodo, [desde, hasta]] of Object.entries(PERIODOS)) {
  const rango = `from=${desde}&until=${hasta}`;
  const total = await leer(page, `${PANEL}?${rango}`, periodo === 'mes');
  const acordar = await leer(page, `${PANEL}?${rango}&payment_method=${ACORDAR}`, periodo === 'mes');
  values.push([periodo, desde, total[0], total[1], acordar[0], acordar[1], ahora]);
}
// Histórico por día del mes (pestaña empretienda_diario) para el gráfico de /canales: siempre hoy y ayer,
// y de a 4 días por corrida los días del mes que todavía falten (así el mes se completa solo en un par de horas).
const DIARIO = 'empretienda_diario';
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
if (!meta.data.sheets?.some((x) => x.properties?.title === DIARIO)) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: DIARIO } } }] },
  });
}
const previas = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${DIARIO}'!A2:F` })).data.values ?? [];
const porDia = new Map(previas.map((r) => [r[0], r]));
const deHoy = values.find((v) => v[0] === 'hoy');
const deAyer = values.find((v) => v[0] === 'ayer');
porDia.set(deHoy[1], [deHoy[1], ...deHoy.slice(2)]);
porDia.set(deAyer[1], [deAyer[1], ...deAyer.slice(2)]);
const faltan = [];
for (let d = 2; diaAR(d) >= hoy.slice(0, 8) + '01'; d++) if (!porDia.has(diaAR(d))) faltan.push(diaAR(d));
for (const dia of faltan.slice(0, 4)) {
  const rango = `from=${dia}&until=${dia}`;
  const total = await leer(page, `${PANEL}?${rango}`, false);
  const acordar = await leer(page, `${PANEL}?${rango}&payment_method=${ACORDAR}`, false);
  porDia.set(dia, [dia, total[0], total[1], acordar[0], acordar[1], ahora]);
}
const filas = [...porDia.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: `'${DIARIO}'!A1:F${filas.length + 1}`,
  valueInputOption: 'RAW',
  requestBody: { values: [['dia', 'totalMonto', 'totalCant', 'acordarMonto', 'acordarCant', 'updatedAt'], ...filas] },
});

// Guardar la sesión renovada para la próxima corrida (cifrada: el cache de Actions no es secreto).
const renovada = await context.storageState();
writeFileSync(SESION_ENC, cifrar({ ...renovada, _guardado: new Date().toISOString() }));
await browser.close();

await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values },
});
console.log(`Métricas de Empretienda actualizadas (${values.map((v) => v[0]).join(', ')}) — ${ahora}`);
