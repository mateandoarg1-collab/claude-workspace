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
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';
import { google } from 'googleapis';
import { volcarOrdenes } from './empretienda-ordenes.mjs';

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
const TRANSFERENCIA = 5; // Métricas: payment_method (Mercado Pago 1, Efectivo 2, Acordar 3, Transferencia 5, Mobbex 6, Ualá Bis 7)
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
    // No se espera "networkidle": los rastreadores de Empretienda mandan pedidos sin parar y la página nunca queda
    // quieta. Se espera a que aparezcan los números (o la pantalla de login).
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await Promise.race([
      page.getByText('Volumen de ventas').first().waitFor({ timeout: 45000 }),
      page.waitForURL(/auth0|login/, { timeout: 45000 }),
    ]).catch(() => {});
    if (/auth0|login/.test(page.url())) {
      if (i === 2) throw new Error('No pude iniciar sesión en Empretienda');
      await iniciarSesion(page);
      continue;
    }
    if (esMes || page.url().includes('from=')) break;
    if (i === 2) throw new Error(`Empretienda no aplicó el filtro: ${url}`);
  }
  await page.getByText('Volumen de ventas').first().waitFor({ timeout: 30000 });
  if (esMes) {
    // Mes en curso: vista por defecto ("Ventas de Octubre"). Con fechas explícitas, Empretienda corta en 1.500 ventas.
    const mes = new Date().toLocaleDateString('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' });
    const t = await page.innerText('body');
    if (!t.toLowerCase().includes(`ventas de ${mes}`)) throw new Error(`Métricas no muestra "Ventas de ${mes}": ${url}`);
  }
  // Empretienda va completando los números mientras carga (trae las ventas de a 750): leer hasta que el número se
  // quede quieto. Si la cantidad es múltiplo de 750 puede estar esperando la próxima tanda: ahí se espera más.
  let previo = '';
  let quietas = 0;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(2000);
    const texto = await page.innerText('body');
    const actual = [numero(texto, 'Volumen de ventas'), numero(texto, 'Cantidad de ventas')];
    quietas = actual.join() === previo ? quietas + 1 : 0;
    previo = actual.join();
    const falta = actual[1] > 0 && actual[1] % 750 === 0 ? 5 : 1;
    if (quietas >= falta) return actual;
  }
  throw new Error(`Los números de Métricas no se estabilizaron: ${url}`);
}

// "Listado de productos" → "Descargar listado" (el segundo botón; el primero es el de clientes). Es el mismo Excel
// "Productos vendidos" con el que se armaron las reglas de scripts/cmv. Si falla, sigue sin CMV.
async function bajarListado(page, archivo) {
  try {
    const boton = page.getByRole('button', { name: /descargar listado/i }).last(); // el de "Listado de productos" va último
    await boton.scrollIntoViewIfNeeded();
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), boton.click()]);
    await descarga.saveAs(archivo);
    return archivo;
  } catch (e) {
    console.log(`No pude bajar el listado de productos (${archivo}): ${e.message.split('\n')[0]}`);
    return null;
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 1280, height: 800 },
  timezoneId: 'America/Argentina/Buenos_Aires',
  storageState: sesionInicial(),
});
// Empretienda sumó grabación de sesión (Amplitude) y otros rastreadores que mandan pedidos sin parar: con ellos la
// página nunca llega a "networkidle" y la lectura se corta por timeout (desde el 20-oct-2026). Se bloquean.
await context.route(/amplitude\.com|braze\.com|d22fxaf9t8d39k\.cloudfront\.net|googletagmanager|google-analytics|analytics\.google|doubleclick|ccm\/collect/, (r) => r.abort());
const page = await context.newPage();

const ahora = new Date().toISOString();
const values = [];
const listados = {}; // periodo → { total, acordar } (rutas de los Excel de productos)
for (const [periodo, [desde, hasta]] of Object.entries(PERIODOS)) {
  const rango = `from=${desde}&until=${hasta}`;
  const esMes = periodo === 'mes';
  // el mes va sin fechas (vista por defecto): con fechas explícitas Empretienda corta en 1.500 ventas
  const total = await leer(page, esMes ? PANEL : `${PANEL}?${rango}`, esMes);
  const lTotal = await bajarListado(page, `/tmp/listado-${periodo}-total.xlsx`);
  const acordar = await leer(page, esMes ? `${PANEL}?payment_method=${ACORDAR}` : `${PANEL}?${rango}&payment_method=${ACORDAR}`, esMes);
  const lAcordar = await bajarListado(page, `/tmp/listado-${periodo}-acordar.xlsx`);
  // Ventas por transferencia (no llevan IVA): para la vista "Sin IVA" del CMV. Si falla, sigue sin ese dato.
  const transf = await leer(page, esMes ? `${PANEL}?payment_method=${TRANSFERENCIA}` : `${PANEL}?${rango}&payment_method=${TRANSFERENCIA}`, esMes).catch(() => null);
  listados[periodo] = { total: lTotal, acordar: lAcordar, cantTotal: total[1], cantAcordar: acordar[1], montoTransf: transf ? transf[0] : '' };
  if (total[1] === 1500 || acordar[1] === 1500) throw new Error(`Empretienda devolvió exactamente 1.500 ventas (${periodo}): probable corte`);
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
const hojasMayorista = meta.data.sheets.map((x) => x.properties?.title);
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

// CMV de Tienda Online y Local (pestaña cmv_empretienda, la lee /canales). Costos: scripts/cmv/costos_base.json, encima
// la planilla "Costos JP - meli" (col F SKU, col G costo neto) y encima costos_override.json. Local = Acordar:
// sin despacho, 1 bolsa por pedido. Online = total − Acordar.
try {
  const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
  const costos = JSON.parse(readFileSync('scripts/cmv/costos_base.json', 'utf8'));
  const hojas = (await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP })).data.sheets.map((h) => h.properties.title);
  for (const h of hojas.filter((h) => !['BASE scalify', 'Hoja 22'].includes(h))) {
    const filas = (await sheets.spreadsheets.values.get({ spreadsheetId: COSTOS_JP, range: `'${h}'!F2:G400` })).data.values ?? [];
    for (const [sku, c] of filas) {
      const n = Number(String(c ?? '').replace(/[$\s.]/g, '').replace(',', '.'));
      if (sku?.trim() && c && n > 0) costos[sku.trim()] = n;
    }
  }
  const override = JSON.parse(readFileSync('scripts/cmv/costos_override.json', 'utf8'));
  for (const [k, v] of Object.entries(override)) if (!k.startsWith('_')) costos[k] = v;
  writeFileSync('/tmp/costos.json', JSON.stringify(costos));

  const archivos = Object.values(listados).flatMap((l) => [l.total, l.acordar]).filter(Boolean);
  const res = archivos.length
    ? JSON.parse(execFileSync('python3', ['scripts/cmv/cmv.py', '/tmp/costos.json', ...archivos], { encoding: 'utf8' }))
    : {};
  const filasCmv = [['periodo', 'onlineFact', 'onlineCmv', 'onlinePack', 'localFact', 'localCmv', 'localPack', 'updatedAt', 'onlineTransfMonto']];
  const revisar = new Map();
  for (const [periodo, l] of Object.entries(listados)) {
    const t = res[l.total], a = res[l.acordar];
    if (!t || !a) continue;
    // Local (Acordar = retiro): 1 bolsa por pedido. Online: empaque por mate + 1 caja de despacho por pedido, con el
    // costo promedio de caja de lo que se vendió (el listado trae una caja por unidad).
    const localPack = Math.round(l.cantAcordar * costos['PACK-BOL-11001']);
    const cajasU = t.despacho_u - a.despacho_u;
    const cajaProm = cajasU > 0 ? (t.despacho - a.despacho) / cajasU : 0;
    const onlinePack = Math.round(t.empaque - a.empaque + cajaProm * (l.cantTotal - l.cantAcordar));
    filasCmv.push([periodo, t.facturacion - a.facturacion, t.cmv - a.cmv, onlinePack, a.facturacion, a.cmv, localPack, ahora, l.montoTransf]);
    for (const [n, q] of Object.entries(t.sin_regla)) revisar.set(n, Math.max(revisar.get(n) ?? 0, q));
  }
  const tabs = [];
  // Unidades vendidas por SKU del mes en curso (Tienda Online y Local) → pestaña unidades_sku, para el % de falla de
  // /posventa. Se reemplazan solo las filas del mes en curso; los meses anteriores quedan como historial.
  const lm = listados.mes;
  if (lm && res[lm.total] && res[lm.acordar]) {
    const mesAct = hoy.slice(0, 7);
    const previas = hojasMayorista.includes('unidades_sku')
      ? ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'unidades_sku'!A2:D" })).data.values ?? []).filter((r) => r[0] !== mesAct)
      : [];
    const t = res[lm.total].skus, a = res[lm.acordar].skus;
    const nuevas = Object.keys(t).sort().map((sku) => [mesAct, sku, (t[sku] ?? 0) - (a[sku] ?? 0), a[sku] ?? 0]);
    tabs.push(['unidades_sku', [['mes', 'sku', 'online', 'local'], ...previas, ...nuevas]]);
  }
  for (const [tab, values] of [...tabs,
    ['cmv_empretienda', filasCmv],
    ['cmv_revisar', [['Publicación sin regla (unidades del mes)', 'unidades'], ...[...revisar].sort((x, y) => y[1] - x[1])]],
  ]) {
    if (!hojasMayorista.includes(tab)) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
    }
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A:Z` });
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values } });
  }
  console.log(`CMV Empretienda actualizado (${filasCmv.length - 1} períodos, ${revisar.size} publicaciones sin regla)`);
} catch (e) {
  console.log(`::warning::No pude calcular el CMV: ${e.message.split('\n')[0]}`);
}

// Órdenes y catálogo (pestañas emp_ordenes y emp_productos) para /estadisticas. Si falla, las métricas siguen.
try {
  await volcarOrdenes(page, sheets, SPREADSHEET_ID);
} catch (e) {
  console.log(`::warning::No pude bajar las órdenes: ${String(e?.message ?? e).split('\n')[0]}`);
}

// Histórico mensual (pestaña historico_mensual, la lee /canales): Tienda Online y Local del mes en curso. Se pisa en
// cada lectura, así el último valor del mes queda como su cierre. Mercado Libre, Shopify y Mayorista los guarda el
// cron de Vercel (/api/canales/historico/guardar).
try {
  const mesRow = values.find((v) => v[0] === 'mes');
  if (mesRow) {
    const HIST = 'historico_mensual';
    const mesAct = hoy.slice(0, 7);
    const titulos = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' })).data.sheets.map((x) => x.properties?.title);
    if (!titulos.includes(HIST)) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: HIST } } }] } });
    }
    const previas = ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [])
      .filter((r) => !(r[0] === mesAct && (r[1] === 'online' || r[1] === 'local')));
    const [, , tMonto, tCant, aMonto, aCant] = mesRow;
    const nuevas = [
      [mesAct, 'online', tMonto - aMonto, tCant - aCant, 'Métricas Empretienda (total − Acordar)', ahora],
      [mesAct, 'local', aMonto, aCant, 'Métricas Empretienda (Acordar)', ahora],
    ];
    const todas = [...previas, ...nuevas].sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A:F` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A1`, valueInputOption: 'RAW',
      requestBody: { values: [['mes', 'canal', 'monto', 'ventas', 'fuente', 'actualizado'], ...todas] },
    });
  }
} catch (e) {
  console.log(`::warning::No pude guardar el histórico mensual: ${e.message.split('\n')[0]}`);
}

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
