// Métricas de Empretienda (hoy / ayer / semana / mes) → planilla, sin la Mac: lo corre el servidor de DonWeb cada 30 min
// (scripts/servidor). El modo GitHub Actions (.github/workflows/empretienda.yml, deshabilitado) queda de respaldo.
// Hace lo mismo que empretienda_metricas.py de mateandobot: entra a panel.empretienda.com/metricas, lee total y "Acordar" (= Local) y escribe
// dashboard_manual!A5:G8, que es lo que muestra /canales.
//
// Sesión: Empretienda pide un código por mail al entrar desde un navegador nuevo, así que se usa una
// sesión ya iniciada. Hay dos fuentes y se usa la más nueva:
//   - secreto EMPRETIENDA_STATE: lo subía mateandobot desde la Mac (ya no corre ahí);
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
import { armarManuales } from './cmv/costos-manuales.mjs';

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
  if (PERFIL) throw new Error('Se cerró la sesión de Empretienda del servidor: hay que iniciarla de nuevo a mano (scripts/servidor/README.md)');
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

// Métricas nueva: /metricas/ventas?from=DD-MM-YYYY&to=DD-MM-YYYY. Desde el 24-nov-2026 (~16:30) la página ya no pide
// …/shops/sales/summary ni …/payment-methods (versión del 17-nov): baja las órdenes pagas del rango de
// dashboard.empretienda.ar.ua.la/1/orders?payment_status=1&from=…&until=…&page=N&limit=750 y suma del lado del navegador.
// Se lee esa respuesta (y las páginas siguientes con el mismo token si vienen 750) y se suma igual: total con envío
// (o.total, como el "Volumen de ventas") y cantidad; Acordar = medio 3, Transferencia = medio 5. Comparado con lo leído
// con la versión anterior: 20/11 y 23/11 dan idénticos, y el mes al 24/11 da el mismo Acordar (135 órdenes).
const fechaEmp = (d) => d.split('-').reverse().join('-');
async function leerApi(page, desde, hasta) {
  for (let i = 0; ; i++) {
    const espera = page.waitForResponse((r) => r.url().includes('ua.la/1/orders?') && r.url().includes('payment_status=1') && r.url().includes(`from=${desde}T`) && r.status() === 200, { timeout: 60000 }).catch(() => null);
    await page.goto(`${PANEL}/ventas?from=${fechaEmp(desde)}&to=${fechaEmp(hasta)}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const r = await espera;
    if (!r) {
      if (i === 2) throw new Error(`Métricas no devolvió los números (${desde} a ${hasta}): ${page.url()}`);
      if (/auth0|login/.test(page.url())) await iniciarSesion(page);
      continue;
    }
    let ordenes = await r.json();
    if (!Array.isArray(ordenes)) throw new Error(`Métricas: la respuesta de órdenes cambió de forma (${desde} a ${hasta})`);
    const limit = Number(new URL(r.url()).searchParams.get('limit')) || 750;
    if (ordenes.length >= limit) {
      const h = await r.request().allHeaders();
      const headers = { authorization: h.authorization, accept: 'application/json', origin: h.origin, referer: h.referer };
      for (let p = 1; ; p++) {
        if (p > 50) throw new Error(`Métricas: demasiadas páginas de órdenes (${desde} a ${hasta})`);
        const u = new URL(r.url());
        u.searchParams.set('page', String(p));
        const rp = await page.request.get(u.toString(), { headers });
        if (!rp.ok()) throw new Error(`Métricas: la página ${p} de órdenes respondió ${rp.status()} (${desde} a ${hasta})`);
        const mas = await rp.json();
        ordenes = ordenes.concat(mas);
        if (mas.length < limit) break;
      }
    }
    const sumar = (lista) => [Math.round(lista.reduce((s, o) => s + Number(o.total || 0), 0)), lista.length];
    const deMedio = (m) => ordenes.filter((o) => Number(o.payment?.method) === m);
    // en pesos enteros, como antes (la planilla lee «151112550,15» como texto)
    return { total: sumar(ordenes), acordar: sumar(deMedio(3)), transf: sumar(deMedio(5))[0] };
  }
}

// "Listado de productos" → "Descargar listado" (el segundo botón; el primero es el de clientes). Es el mismo Excel
// "Productos vendidos" con el que se armaron las reglas de scripts/cmv. Si falla, sigue sin CMV.
async function bajarListado(page, archivo) {
  try {
    const boton = page.getByRole('button', { name: /descargar/i }).last(); // el de "Listado de productos" va último
    await boton.scrollIntoViewIfNeeded();
    const [descarga] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), boton.click()]);
    await descarga.saveAs(archivo);
    return archivo;
  } catch (e) {
    console.log(`No pude bajar el listado de productos (${archivo}): ${e.message.split('\n')[0]}`);
    return null;
  }
}

// En el servidor (EMPRETIENDA_PERFIL, ver scripts/servidor): navegador con perfil propio, logueado una vez a mano; la
// sesión se mantiene sola como en el bot de la Mac. En GitHub Actions: la sesión guardada (secreto / .sesion.enc).
const PERFIL = process.env.EMPRETIENDA_PERFIL;
const opciones = { acceptDownloads: true, viewport: { width: 1280, height: 800 }, timezoneId: 'America/Argentina/Buenos_Aires' };
const browser = PERFIL ? null : await chromium.launch();
const context = PERFIL
  ? await chromium.launchPersistentContext(PERFIL, { ...opciones, headless: false })
  : await browser.newContext({ ...opciones, storageState: sesionInicial() });
// Empretienda sumó grabación de sesión (Amplitude) y otros rastreadores que mandan pedidos sin parar: con ellos la
// página nunca llega a "networkidle" y la lectura se corta por timeout (desde el 20-oct-2026). Se bloquean.
await context.route(/amplitude\.com|braze\.com|d22fxaf9t8d39k\.cloudfront\.net|googletagmanager|google-analytics|analytics\.google|doubleclick|ccm\/collect/, (r) => r.abort());
const page = await context.newPage();

const ahora = new Date().toISOString();
const values = [];
const listados = {}; // periodo → { total, acordar } (rutas de los Excel de productos)
// Si Métricas falla (Empretienda cambia la página seguido: 17-nov y 24-nov), igual se bajan las órdenes más abajo:
// emp_ordenes la usan el tildador del servidor, la planilla de Zeta y la lista "no enviar" de los recordatorios.
// Sin Métricas no se pisa nada de lo que sale de ahí (dashboard, diario, CMV, histórico) y la corrida termina con error.
let errorMetricas = null;
try {
  for (const [periodo, [desde, hasta]] of Object.entries(PERIODOS)) {
    const { total, acordar, transf } = await leerApi(page, desde, hasta);
    // Listado de productos para el CMV: el de todo el período (botón "Descargar" de productos). El de Acordar ya no se
    // puede filtrar desde la dirección; desde el 9-nov el local va por la caja, así que si no hubo Acordar vale cero.
    const lTotal = await bajarListado(page, `/tmp/listado-${periodo}-total.xlsx`);
    listados[periodo] = { total: lTotal, acordar: null, cantTotal: total[1], cantAcordar: acordar[1], montoTransf: transf };
    values.push([periodo, desde, total[0], total[1], acordar[0], acordar[1], ahora]);
  }
} catch (e) {
  errorMetricas = e;
  console.log(`::warning::No pude leer Métricas (sigo con las órdenes): ${String(e?.message ?? e).split('\n')[0]}`);
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
if (!errorMetricas) try {
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
    const { total, acordar } = await leerApi(page, dia, dia);
    porDia.set(dia, [dia, total[0], total[1], acordar[0], acordar[1], ahora]);
  }
  const filas = [...porDia.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${DIARIO}'!A1:F${filas.length + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [['dia', 'totalMonto', 'totalCant', 'acordarMonto', 'acordarCant', 'updatedAt'], ...filas] },
  });
} catch (e) {
  console.log(`::warning::No pude guardar el histórico diario: ${String(e?.message ?? e).split('\n')[0]}`);
}

// CMV de Tienda Online y Local (pestaña cmv_empretienda, la lee /canales). Costos: scripts/cmv/costos_base.json, encima
// costos_override.json (lo que la planilla no tiene) y encima la planilla "Costos JP - meli" (col F SKU, col G costo neto),
// que manda. Local = Acordar:
// sin despacho, 1 bolsa por pedido. Online = total − Acordar.
if (!errorMetricas) try {
  const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
  const costos = JSON.parse(readFileSync('scripts/cmv/costos_base.json', 'utf8'));
  const override = JSON.parse(readFileSync('scripts/cmv/costos_override.json', 'utf8'));
  for (const [k, v] of Object.entries(override)) if (!k.startsWith('_')) costos[k] = v;
  const hojas = (await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP })).data.sheets.map((h) => h.properties.title);
  for (const h of hojas.filter((h) => !['BASE scalify', 'Hoja 22'].includes(h))) {
    const filas = (await sheets.spreadsheets.values.get({ spreadsheetId: COSTOS_JP, range: `'${h}'!F2:G400` })).data.values ?? [];
    for (const [sku, c] of filas) {
      const n = Number(String(c ?? '').replace(/[$\s.]/g, '').replace(',', '.'));
      if (sku?.trim() && c && n > 0) costos[sku.trim()] = n;
    }
  }
  // Costo cargado a mano por producto en /rentabilidad-tienda/costos (pestaña costos_tienda): gana a las reglas.
  const manuales = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'costos_tienda'!A2:D", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null))?.data.values ?? [];
  costos._productos = armarManuales(manuales)._productos; // el costo vigente hoy
  writeFileSync('/tmp/costos.json', JSON.stringify(costos));

  const archivos = Object.values(listados).flatMap((l) => [l.total, l.acordar]).filter(Boolean);
  const res = archivos.length
    ? JSON.parse(execFileSync('python3', ['scripts/cmv/cmv.py', '/tmp/costos.json', ...archivos], { encoding: 'utf8' }))
    : {};
  const filasCmv = [['periodo', 'onlineFact', 'onlineCmv', 'onlinePack', 'localFact', 'localCmv', 'localPack', 'updatedAt', 'onlineTransfMonto']];
  const revisar = new Map();
  for (const [periodo, l] of Object.entries(listados)) {
    const CERO = { facturacion: 0, cmv: 0, empaque: 0, despacho: 0, despacho_u: 0, skus: {}, sin_regla: {} };
    const t = res[l.total], a = res[l.acordar] ?? (l.cantAcordar === 0 ? CERO : null);
    if (!t || !a) continue;
    // listado vacío con ventas (la tabla de productos de la Métricas nueva a veces da error): no pisar el CMV con ceros
    if (!t.unidades && l.cantTotal > 0) continue;
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
  if (lm && res[lm.total] && (res[lm.acordar] || lm.cantAcordar === 0)) {
    const mesAct = hoy.slice(0, 7);
    const previas = hojasMayorista.includes('unidades_sku')
      ? ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'unidades_sku'!A2:D" })).data.values ?? []).filter((r) => r[0] !== mesAct)
      : [];
    const t = res[lm.total].skus, a = res[lm.acordar]?.skus ?? {};
    const nuevas = Object.keys(t).sort().map((sku) => [mesAct, sku, (t[sku] ?? 0) - (a[sku] ?? 0), a[sku] ?? 0]);
    tabs.push(['unidades_sku', [['mes', 'sku', 'online', 'local'], ...previas, ...nuevas]]);
  }
  for (const [tab, values] of [...tabs,
    // sin ningún período con listado: queda el CMV anterior
    ...(filasCmv.length > 1 ? [['cmv_empretienda', filasCmv]] : []),
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
if (!errorMetricas) try {
  const mesRow = values.find((v) => v[0] === 'mes');
  if (mesRow) {
    const HIST = 'historico_mensual';
    const mesAct = hoy.slice(0, 7);
    const titulos = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' })).data.sheets.map((x) => x.properties?.title);
    if (!titulos.includes(HIST)) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: HIST } } }] } });
    }
    // mes siempre "YYYY-MM": si Sheets lo pasó a fecha (número de serie, 46327 = nov-2026) se vuelve a texto (18-nov-2026)
    const normalizarMes = (v) => {
      const s = String(v ?? '').trim();
      if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 7);
      const m = s.match(/^(\d{4})-(\d{2})-\d{2}/);
      return m ? `${m[1]}-${m[2]}` : s;
    };
    const previas = ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [])
      .map((r) => [normalizarMes(r[0]), ...r.slice(1)])
      .filter((r) => !(r[0] === mesAct && (r[1] === 'online' || r[1] === 'local')));
    const [, , tMonto, tCant, aMonto, aCant] = mesRow;
    const nuevas = [
      [mesAct, 'online', tMonto - aMonto, tCant - aCant, 'Métricas Empretienda (total − Acordar)', ahora],
      [mesAct, 'local', aMonto, aCant, 'Métricas Empretienda (Acordar)', ahora],
    ];
    // un (mes, canal) repetido: vale el guardado más reciente
    const unica = new Map();
    for (const r of [...previas, ...nuevas]) {
      const k = `${r[0]}|${r[1]}`;
      if (!unica.has(k) || String(r[5] ?? '') > String(unica.get(k)[5] ?? '')) unica.set(k, r);
    }
    const todas = [...unica.values()].sort((x, y) => String(x[0]).localeCompare(String(y[0])) || String(x[1]).localeCompare(String(y[1])));
    await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A:F` });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${HIST}'!A1`, valueInputOption: 'RAW',
      requestBody: { values: [['mes', 'canal', 'monto', 'ventas', 'fuente', 'actualizado'], ...todas] },
    });
  }
} catch (e) {
  console.log(`::warning::No pude guardar el histórico mensual: ${e.message.split('\n')[0]}`);
}

// Guardar la sesión renovada para la próxima corrida (cifrada: el cache de Actions no es secreto). Con perfil propio
// la guarda el navegador.
if (!PERFIL) {
  const renovada = await context.storageState();
  writeFileSync(SESION_ENC, cifrar({ ...renovada, _guardado: new Date().toISOString() }));
}
await context.close();
await browser?.close();

if (errorMetricas) {
  // mismo texto que antes en el log (y "Se cerró la sesión…" si fue eso, para el aviso por mail de leer-metricas.sh)
  console.log(`Error: ${String(errorMetricas?.message ?? errorMetricas)}`);
  process.exit(1);
}
await sheets.spreadsheets.values.update({
  spreadsheetId: SPREADSHEET_ID,
  range: RANGE,
  valueInputOption: 'RAW',
  requestBody: { values },
});
console.log(`Métricas de Empretienda actualizadas (${values.map((v) => v[0]).join(', ')}) — ${ahora}`);
