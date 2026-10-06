// Egresos de Mercado Pago → Google Sheet (diario).
//
// Fuentes:
//   1. /v1/payments/search con payer.id = cuenta propia → débitos con tarjeta MP,
//      pagos por checkout/QR, transferencias a cuentas MP, ARCA, etc.
//   2. release_report (reporte de movimientos) → filas `payout` = transferencias a CBU
//      externos, que NO aparecen en payments/search. No traen nombre: se resuelven
//      con la pestaña "CBU" de la planilla.
//
// Pestañas de la planilla:
//   Egresos — Fecha | Monto | Destinatario | Categoría | Tipo | Detalle | Estado | ID
//   Reglas  — Contiene | Categoría   (se busca en Destinatario + Detalle, sin mayúsculas)
//   CBU     — CBU | Destinatario      (los CBU nuevos se agregan solos con nombre vacío)
//
// Uso:
//   node scripts/mp-egresos.mjs                 # últimos 3 días (lo que corre el launchd)
//   node scripts/mp-egresos.mjs --desde 2026-09-01
//   node scripts/mp-egresos.mjs --dry           # muestra en consola, no escribe la planilla

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { google } from 'googleapis';

const CONFIG = JSON.parse(readFileSync(new URL('../data/egresos-mp-config.json', import.meta.url), 'utf-8'));
const SHEET_ID = CONFIG.spreadsheetId;
const MY_ID = 1136055893;
const MP = 'https://api.mercadopago.com';

const raw = readFileSync(`${homedir()}/.claude/.mercadopago`, 'utf-8');
const TOKEN = raw.match(/MERCADOPAGO_ACCESS_TOKEN=(.+)/)?.[1]?.trim();
if (!TOKEN) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN en ~/.claude/.mercadopago');

const args = process.argv.slice(2);
const desdeArg = args.includes('--desde') ? args[args.indexOf('--desde') + 1] : null;
const desde = desdeArg ? new Date(`${desdeArg}T00:00:00-03:00`) : new Date(Date.now() - 3 * 864e5);
const hasta = new Date();

// Movimientos que no son gasto: plata que entra, que va a la alcancía o validaciones de tarjeta.
const EXCLUIR_OPERACION = new Set(['account_fund', 'partition_transfer', 'card_validation', 'operation_fund']);
const EXCLUIR_ESTADO = new Set(['rejected', 'cancelled', 'refunded', 'charged_back']);
const DESCRIPCION_GENERICA = /^(producto sin descripci[oó]n|varios|\d+)?$/i;

const REGLAS_INICIALES = [
  ['facebk', 'Publicidad'], ['facebook', 'Publicidad'], ['tiktok', 'Publicidad'], ['google', 'Publicidad'],
  ['shopify', 'Plataformas'], ['apple.com', 'Plataformas'], ['nubimetrics', 'Plataformas'],
  ['empretienda', 'Plataformas'], ['openai', 'Plataformas'], ['chatgpt', 'Plataformas'],
  ['anthropic', 'Plataformas'], ['canva', 'Plataformas'],
  ['arca', 'Impuestos'], ['afip', 'Impuestos'], ['agip', 'Impuestos'], ['arba', 'Impuestos'], ['faecys', 'Impuestos'],
  ['correo argentino', 'Envíos'], ['andreani', 'Envíos'], ['oca ', 'Envíos'],
];

async function mp(path, opts = {}) {
  const res = await fetch(`${MP}${path}`, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...opts.headers } });
  if (!res.ok) throw new Error(`MP ${path} → ${res.status} ${await res.text()}`);
  return path.endsWith('.csv') ? res.text() : res.json();
}

const sinMs = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const fechaAR = (iso) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 16);

const nicknames = new Map();
async function nickname(userId) {
  if (!userId) return '';
  if (!nicknames.has(userId)) {
    nicknames.set(userId, await mp(`/users/${userId}`).then((u) => u.nickname).catch(() => `MP ${userId}`));
  }
  return nicknames.get(userId);
}

async function pagosHechos() {
  const out = [];
  for (let offset = 0; ; offset += 100) {
    const q = new URLSearchParams({
      'payer.id': MY_ID, sort: 'date_created', criteria: 'asc', limit: 100, offset,
      range: 'date_created', begin_date: desde.toISOString(), end_date: hasta.toISOString(),
    });
    const { results, paging } = await mp(`/v1/payments/search?${q}`);
    for (const p of results) {
      if (EXCLUIR_OPERACION.has(p.operation_type) || EXCLUIR_ESTADO.has(p.status)) continue;
      const poi = p.point_of_interaction ?? {};
      const comercio = poi.transaction_data?.commerce?.name;
      const desc = (p.description ?? '').trim();
      const collectorId = p.collector?.id ?? p.collector_id;
      const destinatario = comercio || (DESCRIPCION_GENERICA.test(desc) ? await nickname(collectorId) : desc);
      out.push({
        fecha: fechaAR(p.date_created),
        monto: p.transaction_amount,
        destinatario,
        tipo: tipoPago(p),
        detalle: desc,
        estado: p.status,
        id: String(p.id),
      });
    }
    if (offset + 100 >= paging.total) break;
  }
  return out;
}

function tipoPago(p) {
  const sub = p.point_of_interaction?.business_info?.sub_unit;
  if (p.operation_type === 'money_transfer') return 'Transferencia MP';
  if (sub === 'debit_card') return 'Tarjeta MP';
  if (sub === 'qr') return 'QR';
  if (p.operation_type === 'recurring_payment') return 'Suscripción';
  return 'Pago';
}

async function transferenciasCBU() {
  // El id que devuelve el POST no coincide con el de /list: se identifica por fecha de creación.
  const pedido = Date.now() - 5000;
  await mp('/v1/account/release_report', {
    method: 'POST',
    body: JSON.stringify({ begin_date: sinMs(desde), end_date: sinMs(hasta) }),
  });
  let fileName;
  for (let i = 0; i < 40 && !fileName; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const list = await mp('/v1/account/release_report/list');
    fileName = list
      .filter((r) => r.file_name && new Date(r.date_created).getTime() >= pedido)
      .sort((a, b) => b.date_created.localeCompare(a.date_created))[0]?.file_name;
  }
  if (!fileName) throw new Error('El reporte de movimientos no se generó a tiempo');

  const [header, ...lines] = (await mp(`/v1/account/release_report/${fileName}`)).trim().split('\n');
  const cols = header.split(';');
  return lines
    .map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v.trim()])))
    .filter((r) => r.DESCRIPTION === 'payout' && Number(r.NET_DEBIT_AMOUNT) > 0)
    .map((r) => ({
      fecha: fechaAR(r.DATE),
      monto: Number(r.NET_DEBIT_AMOUNT),
      cbu: r.PAYOUT_BANK_ACCOUNT_NUMBER,
      tipo: 'Transferencia CBU',
      detalle: `CBU ${r.PAYOUT_BANK_ACCOUNT_NUMBER}`,
      estado: 'approved',
      id: `payout-${r.SOURCE_ID}`,
    }));
}

// ---------- Google Sheets ----------

const auth = new google.auth.GoogleAuth({
  keyFile: `${homedir()}/.claude/.mateando-credentials.json`,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

async function asegurarPestanas() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existentes = new Set(meta.data.sheets.map((s) => s.properties.title));
  const headers = {
    Egresos: ['Fecha', 'Monto', 'Destinatario', 'Categoría', 'Tipo', 'Detalle', 'Estado', 'ID'],
    Reglas: ['Contiene', 'Categoría'],
    CBU: ['CBU', 'Destinatario'],
  };
  const nuevas = Object.keys(headers).filter((t) => !existentes.has(t));
  if (!nuevas.length) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests: nuevas.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
  });
  for (const t of nuevas) {
    const rows = [headers[t], ...(t === 'Reglas' ? REGLAS_INICIALES : [])];
    await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `${t}!A1`, valueInputOption: 'RAW', requestBody: { values: rows } });
  }
}

const leer = async (range) => (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range })).data.values ?? [];

async function main() {
  console.log(`[${new Date().toISOString()}] Egresos MP desde ${desde.toISOString()}`);
  const [pagos, payouts] = await Promise.all([pagosHechos(), transferenciasCBU()]);

  if (args.includes('--dry')) {
    for (const e of [...pagos, ...payouts]) console.log(e.fecha, e.tipo.padEnd(17), String(e.monto).padStart(14), e.destinatario ?? `CBU …${e.cbu.slice(-6)}`, '|', e.detalle);
    return;
  }
  await asegurarPestanas();

  const egresos = await leer('Egresos!A2:H');
  const reglas = (await leer('Reglas!A2:B')).filter((r) => r[0] && r[1]).map(([k, c]) => [k.toLowerCase(), c]);
  const cbus = await leer('CBU!A2:B');
  const cbuNombre = new Map(cbus.map(([c, n]) => [c, n ?? '']));

  // Aprender: categorías puestas a mano en Egresos para destinatarios sin regla → nueva regla.
  const categoriaDe = (texto) => reglas.find(([k]) => texto.toLowerCase().includes(k))?.[1] ?? '';
  const reglasNuevas = [];
  for (const r of egresos) {
    const [dest, cat] = [r[2], r[3]];
    if (dest && cat && cat !== 'Sin categoría' && !dest.startsWith('CBU ') && !categoriaDe(dest)) {
      reglas.push([dest.toLowerCase(), cat]);
      reglasNuevas.push([dest, cat]);
    }
  }

  // CBU nuevos → se agregan a la pestaña CBU con nombre vacío para completar.
  const cbusNuevos = [...new Set(payouts.map((p) => p.cbu))].filter((c) => c && !cbuNombre.has(c));
  cbusNuevos.forEach((c) => cbuNombre.set(c, ''));

  const ids = new Set(egresos.map((r) => r[7]));
  const filas = [...pagos, ...payouts]
    .filter((e) => !ids.has(e.id))
    .map((e) => {
      const destinatario = e.cbu ? cbuNombre.get(e.cbu) || `CBU …${e.cbu.slice(-6)}` : e.destinatario;
      return [e.fecha, e.monto, destinatario, categoriaDe(`${destinatario} ${e.detalle}`) || 'Sin categoría', e.tipo, e.detalle, e.estado, e.id];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Completar filas existentes: CBU ya nombrados y categorías que ahora tienen regla.
  const updates = [];
  egresos.forEach((r, i) => {
    const fila = i + 2;
    const cbu = r[5]?.startsWith('CBU ') ? r[5].slice(4) : null;
    if (cbu && cbuNombre.get(cbu) && r[2] !== cbuNombre.get(cbu)) {
      r[2] = cbuNombre.get(cbu);
      updates.push({ range: `Egresos!C${fila}`, values: [[r[2]]] });
    }
    if (!r[3] || r[3] === 'Sin categoría') {
      const cat = categoriaDe(`${r[2]} ${r[5] ?? ''}`);
      if (cat) updates.push({ range: `Egresos!D${fila}`, values: [[cat]] });
    }
  });

  if (reglasNuevas.length) await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'Reglas!A:B', valueInputOption: 'RAW', requestBody: { values: reglasNuevas } });
  if (cbusNuevos.length) await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'CBU!A:B', valueInputOption: 'RAW', requestBody: { values: cbusNuevos.map((c) => [c, '']) } });
  if (updates.length) await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET_ID, requestBody: { valueInputOption: 'RAW', data: updates } });
  if (filas.length) await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: 'Egresos!A:H', valueInputOption: 'RAW', requestBody: { values: filas } });

  console.log(`✅ ${filas.length} egresos nuevos (${pagos.length} pagos + ${payouts.length} transferencias CBU en el rango), ${updates.length} filas actualizadas, ${cbusNuevos.length} CBU nuevos, ${reglasNuevas.length} reglas aprendidas`);
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
