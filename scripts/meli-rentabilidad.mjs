// Rentabilidad de Mercado Libre por orden, con las mismas reglas que usaba Escalafy (data/escalafy/REGLAS-MELI.md):
// venta, comisión y envío de ML sin IVA (÷1,21), impuestos 5% de la venta, Flex por cordón, costo de la pestaña costos_meli.
// Escribe la pestaña rentabilidad_meli (una fila por orden) y rentabilidad_meli_ads (pauta de ML Ads por día)
// en la planilla MATEANDO MAYORISTA 2026, que lee /api/ml/rentabilidad.
// Recalcula los últimos N días porque las órdenes cambian (reembolsos, envíos que ML recotiza):
//   node scripts/meli-rentabilidad.mjs              → 45 días a las 6 de la mañana, 3 días el resto de las horas
//   node scripts/meli-rentabilidad.mjs --dias 10
//   node scripts/meli-rentabilidad.mjs --check ordenes-escalafy.json   → compara orden por orden contra list_orders de Escalafy
import { readFileSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'rentabilidad_meli';
const TAB_ADS = 'rentabilidad_meli_ads';
const SELLER = 1136055893;
const ADS_ADVERTISER_ID = 684717;
const IVA = 1.21;
const IMPUESTOS = 0.05;
// Flex netos de IVA (Juampi, 24-oct-2026). El cordón sale del código postal (scripts/meli/flex-cordones.json, sacado de Escalafy).
const FLEX = { caba: 3400, 1: 5200, 2: 6500, 3: 8000 };
const CORDONES = JSON.parse(readFileSync(new URL('./meli/flex-cordones.json', import.meta.url), 'utf8'));
const CP_CONOCIDOS = Object.keys(CORDONES).map(Number).sort((a, b) => a - b);

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const CHECK = arg('--check');
const DRY = args.includes('--dry') || !!CHECK;
const horaAR = new Date(Date.now() - 3 * 3600e3).getUTCHours();
const DIAS = Number(arg('--dias') ?? (horaAR === 6 ? 45 : 3));

const TOKEN = execSync(`bash ${homedir()}/.claude/scripts/ml-token.sh`).toString().trim();
async function ml(path, headers = {}) {
  for (let intento = 0; ; intento++) {
    const r = await fetch(`https://api.mercadolibre.com${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, ...headers } }).catch((e) => {
      if (intento < 4) return null; // corte de red: reintentar
      throw e;
    });
    if (!r) {
      await new Promise((ok) => setTimeout(ok, 2000 * (intento + 1)));
      continue;
    }
    if (r.ok) return r.json();
    if ((r.status === 429 || r.status >= 500) && intento < 4) {
      await new Promise((ok) => setTimeout(ok, 1000 * (intento + 1)));
      continue;
    }
    throw new Error(`ML ${path}: ${r.status} ${await r.text()}`);
  }
}

// De a `n` en paralelo, para no pasarse del rate limit de ML.
async function enLotes(lista, n, fn) {
  const out = [];
  for (let i = 0; i < lista.length; i += n) out.push(...(await Promise.all(lista.slice(i, i + n).map(fn))));
  return out;
}

const diaAR = (iso) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
function dias(desde, hasta) {
  const out = [];
  for (let d = new Date(`${desde}T12:00:00Z`); d.toISOString().slice(0, 10) <= hasta; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

// De a 3 horas: con pocas órdenes por consulta casi nunca hay que paginar, y la paginación de ML repite y saltea órdenes.
async function ordenesDelDia(dia) {
  const out = [];
  for (let h = 0; h < 24; h += 3) {
    const hh = (n) => String(n).padStart(2, '0');
    for (let offset = 0; ; offset += 50) {
      const q = new URLSearchParams({
        seller: String(SELLER),
        'order.date_created.from': `${dia}T${hh(h)}:00:00.000-03:00`,
        'order.date_created.to': `${dia}T${hh(h + 2)}:59:59.999-03:00`,
        sort: 'date_asc',
        limit: '50',
        offset: String(offset),
      });
      const j = await ml(`/orders/search?${q}`);
      out.push(...j.results);
      if (offset + 50 >= j.paging.total) break;
    }
  }
  return out;
}

// Costo del envío para el vendedor (ya neto de bonificaciones) + logística y destino.
// En Flex ML no cobra ese costo (no aparece en el pago ni en la facturación): al revés, le paga al vendedor
// la bonificación Flex (transferencias "bonificaciones_flex_fc" en MP = `save` del vendedor + envío gratis "loyal"
// que banca ML) y el envío que pagó el comprador. Verificado contra MP en oct-2026.
async function envio(id) {
  const [costos, s] = await Promise.all([ml(`/shipments/${id}/costs`), ml(`/shipments/${id}`, { 'x-format-new': 'true' })]);
  const a = s.destination?.shipping_address ?? {};
  const vendedor = costos.senders?.find((x) => x.user_id === SELLER) ?? {};
  const loyal = (costos.receiver?.discounts ?? []).filter((d) => d.type === 'loyal').reduce((t, d) => t + (d.promoted_amount ?? 0), 0);
  return {
    costo: vendedor.cost ?? 0,
    ingresoFlex: (vendedor.save ?? 0) + loyal + (costos.receiver?.cost ?? 0),
    tipo: s.logistic?.type ?? '',
    estado: a.state?.id ?? '',
    cp: String(a.zip_code ?? ''),
  };
}

// Flex: CABA tarifa fija; provincia por cordón del CP. Un CP que Escalafy nunca mostró toma el cordón del CP conocido
// más cercano y queda marcado como estimado.
function flex(e) {
  const zona = (z, estimado) => ({ costo: FLEX[z], estimado });
  if (e.estado === 'AR-C') return zona('caba', false);
  if (e.estado !== 'AR-B') return { costo: 0, estimado: false };
  if (CORDONES[e.cp]) return zona(CORDONES[e.cp], false);
  const cp = Number(e.cp);
  if (!cp) return { costo: 0, estimado: true };
  const cerca = CP_CONOCIDOS.reduce((a, b) => (Math.abs(b - cp) < Math.abs(a - cp) ? b : a));
  return zona(CORDONES[cerca], true);
}

// Cupones que paga el vendedor (los de ML no se restan). En carritos el cupón no aparece en el pago,
// así que se consulta toda orden con descuento.
async function cuponVendedor(o) {
  if (!o.tags?.includes('order_has_discount') && !(o.payments ?? []).some((p) => p.coupon_amount > 0)) return 0;
  const d = await ml(`/orders/${o.id}/discounts`);
  return (d.details ?? [])
    .filter((x) => x.type === 'coupon')
    .reduce((s, x) => s + x.items.reduce((t, i) => t + (i.amounts?.seller ?? 0), 0), 0);
}

// Costo actual (pestaña costos_meli) y costos viejos con su período (costos_meli_historial): una venta se valora
// con el costo vigente el día que se hizo, como Escalafy.
async function costosMeli(sheets) {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`'costos_meli'!A2:D`, `'costos_meli_historial'!A2:F`],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [actuales, viejos] = res.data.valueRanges ?? [];
  const clave = (item, variante) => (variante && String(variante) !== String(item) ? `${item}|${variante}` : String(item));
  const actual = new Map();
  for (const [item, variante, tipo, costo] of actuales?.values ?? []) actual.set(clave(item, variante), { tipo: String(tipo), costo: Number(costo) || 0 });
  const historial = new Map();
  for (const [item, variante, desde, hasta, tipo, costo] of viejos?.values ?? []) {
    const k = clave(item, variante);
    historial.set(k, [...(historial.get(k) ?? []), { desde: String(desde ?? ''), hasta: String(hasta), tipo: String(tipo ?? ''), costo: Number(costo) || 0 }]);
  }
  const buscar = (k, fecha) => historial.get(k)?.find((v) => (!v.desde || v.desde <= fecha) && fecha < v.hasta) ?? actual.get(k);
  // Una variación sin costo propio usa el de la publicación.
  return (item, variacion, fecha) => (variacion ? buscar(`${item}|${variacion}`, fecha) : undefined) ?? buscar(String(item), fecha);
}

// Envío de la devolución de un reclamo: lo que ML le cobra al vendedor, solo si la devolución ya se despachó.
// Si el producto volvió y el vendedor lo revisó bien (seller_status success), vuelve al stock: su costo no se pierde.
async function devolucion(o) {
  let envio = 0;
  let aStock = false;
  for (const m of o.mediations ?? []) {
    const dev = await ml(`/post-purchase/v2/claims/${m.id}/returns`).catch(() => null);
    if (!dev || !['shipped', 'delivered'].includes(dev.status)) continue;
    for (const sh of dev.shipments ?? []) {
      if (sh.type !== 'return') continue;
      const c = await ml(`/shipments/${sh.shipment_id}/costs`).catch(() => null);
      if (c?.receiver?.user_id === SELLER) envio += c.receiver.cost ?? 0;
    }
    if (dev.status === 'delivered' && dev.id) {
      const r = await ml(`/post-purchase/v1/returns/${dev.id}/reviews`).catch(() => null);
      aStock ||= (r?.reviews ?? []).some((x) => x.resource_reviews?.some((rr) => rr.seller_status === 'success'));
    }
  }
  return { envio, aStock };
}

// Una orden cancelada cuyo envío ya había salido no es anulada: queda la pérdida del envío, del producto
// (salvo que vuelva al stock) y de la devolución, como en Escalafy.
async function salioElEnvio(o) {
  if (!o.shipping?.id) return false;
  const s = await ml(`/shipments/${o.shipping.id}`).catch(() => null);
  return !!s?.status_history?.date_shipped;
}

const r2 = (n) => Math.round(n * 100) / 100;

async function calcular(desde, hasta, costos) {
  // La paginación de /orders/search a veces repite órdenes entre páginas: se dejan una vez.
  const todas = [...new Map((await enLotes(dias(desde, hasta), 4, ordenesDelDia)).flat().map((o) => [o.id, o])).values()];
  // Ventas: paid y partially_refunded. Cancelada antes de despachar = anulada (sin venta ni costos);
  // cancelada después de despachar = pérdida (envío, producto, devolución).
  const ventas = todas.filter((o) => (o.status === 'paid' || o.status === 'partially_refunded') && o.total_amount > 0);
  const canceladas = todas.filter((o) => o.status === 'cancelled' && o.shipping?.id);
  const despachadas = (await enLotes(canceladas, 10, async (o) => ((await salioElEnvio(o)) ? o : null))).filter(Boolean);
  const anuladaConPerdida = new Set(despachadas.map((o) => o.id));
  const ordenes = [...ventas, ...despachadas];
  const idsEnvio = [...new Set(ordenes.map((o) => o.shipping?.id).filter(Boolean))];
  const envios = new Map(await enLotes(idsEnvio, 10, async (id) => [id, await envio(id)]));
  const cupones = new Map(await enLotes(ordenes, 10, async (o) => [o.id, await cuponVendedor(o)]));
  const devoluciones = new Map(await enLotes(ordenes.filter((o) => o.mediations?.length), 5, async (o) => [o.id, await devolucion(o)]));
  // Un carrito comparte el envío: se reparte según el monto de cada orden.
  const totalPorEnvio = new Map();
  for (const o of ordenes) if (o.shipping?.id) totalPorEnvio.set(o.shipping.id, (totalPorEnvio.get(o.shipping.id) ?? 0) + o.total_amount);

  return ordenes.map((o) => {
    const perdida = anuladaConPerdida.has(o.id);
    const dev = devoluciones.get(o.id) ?? { envio: 0, aStock: false };
    const reembolsado = perdida ? o.total_amount : (o.payments ?? []).reduce((s, p) => s + (p.transaction_amount_refunded || 0), 0);
    const bruto = Math.max(0, o.total_amount - reembolsado - (cupones.get(o.id) ?? 0));
    // La comisión se devuelve en proporción a lo reembolsado (el cupón del vendedor no la cambia).
    const proporcionVendida = o.total_amount ? Math.max(0, o.total_amount - reembolsado) / o.total_amount : 0;
    const comision = o.order_items.reduce((s, oi) => s + (oi.sale_fee || 0) * oi.quantity, 0) * proporcionVendida;
    const e = o.shipping?.id ? envios.get(o.shipping.id) : null;
    const parte = e ? o.total_amount / totalPorEnvio.get(o.shipping.id) : 0;
    const esFlex = e?.tipo === 'self_service';
    const f = esFlex ? flex(e) : { costo: 0, estimado: false };
    let costo = 0;
    let sinCosto = 0;
    for (const oi of o.order_items) {
      const c = costos(oi.item.id, oi.item.variation_id, diaAR(o.date_created));
      if (!c || !c.costo) sinCosto += oi.quantity;
      else costo += (c.tipo === '%' ? (oi.unit_price * c.costo) / 100 : c.costo) * oi.quantity;
    }
    if (dev.aStock) costo = 0;
    const venta = bruto / IVA;
    const envioDev = dev.envio / IVA;
    // Flex: negativo = lo que ML le paga al vendedor por el envío.
    const envioMl = ((esFlex ? -e.ingresoFlex : (e?.costo ?? 0)) * parte) / IVA + envioDev;
    const envioFlex = f.costo * parte;
    const impuestos = bruto * IMPUESTOS;
    const comisionSinIva = comision / IVA;
    const oi = o.order_items[0];
    return {
      fecha: diaAR(o.date_created),
      order_id: String(o.id),
      pack_id: o.pack_id ? String(o.pack_id) : '',
      envio_id: o.shipping?.id ? String(o.shipping.id) : '',
      logistica: { fulfillment: 'full', self_service: 'flex', cross_docking: 'colecta', xd_drop_off: 'agencia', drop_off: 'correo' }[e?.tipo] ?? (e?.tipo || 'sin envío'),
      item_id: oi.item.id,
      variante: oi.item.variation_id ? String(oi.item.variation_id) : '',
      titulo: oi.item.title,
      unidades: o.order_items.reduce((s, x) => s + x.quantity, 0),
      venta: r2(venta),
      comision: r2(comisionSinIva),
      envio_ml: r2(envioMl),
      envio_flex: r2(envioFlex),
      impuestos: r2(impuestos),
      costo: r2(costo),
      neto: r2(venta - comisionSinIva - envioMl - envioFlex - impuestos - costo),
      sin_costo: sinCosto,
      flex_estimado: f.estimado ? 1 : 0,
      reembolsado: r2(reembolsado / IVA),
      envio_devolucion: r2(envioDev),
      anulada: perdida ? 1 : 0,
    };
  });
}

// Pauta de ML Ads por día (Product Ads; Display no tiene permisos).
async function adsDelDia(dia) {
  let m = { cost: 0, total_amount: 0, clicks: 0, prints: 0 };
  for (let offset = 0; ; offset += 50) {
    const j = await ml(
      `/advertising/MLA/advertisers/${ADS_ADVERTISER_ID}/product_ads/campaigns/search?limit=50&offset=${offset}&date_from=${dia}&date_to=${dia}&metrics=cost,total_amount,clicks,prints&metrics_summary=true`,
      { 'api-version': '2' },
    );
    const s = j.metrics_summary ?? {};
    m = { cost: m.cost + (s.cost ?? 0), total_amount: m.total_amount + (s.total_amount ?? 0), clicks: m.clicks + (s.clicks ?? 0), prints: m.prints + (s.prints ?? 0) };
    if (offset + 50 >= j.paging.total) return [dia, r2(m.cost), r2(m.total_amount), m.clicks, m.prints];
  }
}

// Reemplaza en la pestaña las filas de los días recalculados y deja el resto como estaba.
async function guardar(sheets, tab, encabezado, filasNuevas, desde, hasta) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  if (!meta.data.sheets.some((s) => s.properties?.title === tab)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
  }
  const prev = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A2:Z` })).data.values ?? [];
  const quedan = prev.filter((r) => r[0] < desde || r[0] > hasta);
  const filas = [...quedan, ...filasNuevas].sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  // Primero se escribe encima y después se borra lo que sobra: la pestaña nunca queda vacía mientras la lee el panel.
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tab}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [encabezado, ...filas] },
  });
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A${filas.length + 2}:Z` });
  return filas.length;
}

// Una corrida a la vez (la de cada hora y una manual podrían pisarse al escribir la planilla).
const LOCK = `${homedir()}/Library/Caches/mateando-meli-rentabilidad.lock`;
if (!DRY) {
  try {
    const pid = Number(readFileSync(LOCK, 'utf8'));
    process.kill(pid, 0);
    console.log(`Ya hay una corrida en curso (pid ${pid}), salgo.`);
    process.exit(0);
  } catch {
    // no hay lock o el proceso ya no existe
  }
  writeFileSync(LOCK, String(process.pid));
  process.on('exit', () => rmSync(LOCK, { force: true }));
}

const auth = new google.auth.GoogleAuth({
  keyFile: `${homedir()}/.claude/.mateando-credentials.json`,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });
const costos = await costosMeli(sheets);

if (CHECK) {
  // Contra Escalafy (list_orders en ARS): mismas fechas, orden por orden.
  // net_revenue de list_orders no resta el Flex (el dashboard sí): se recalcula como el dashboard.
  const esc = JSON.parse(readFileSync(CHECK, 'utf8'))
    .filter((o) => o.counts_as_sale)
    .map((o) => ({ ...o, neto: o.revenue - o.platform_fee - o.shipping_cost - o.private_shipping_cost - o.taxes - o.product_cost }));
  const fechas = esc.map((o) => o.event_date).sort();
  const nuestras = new Map((await calcular(fechas[0], fechas.at(-1), costos)).map((r) => [r.order_id, r]));
  const campos = [['venta', 'revenue'], ['comision', 'platform_fee'], ['envio_ml', 'shipping_cost'], ['envio_flex', 'private_shipping_cost'], ['impuestos', 'taxes'], ['costo', 'product_cost'], ['neto', 'neto']];
  const tot = Object.fromEntries(campos.map(([k]) => [k, { nuestro: 0, escalafy: 0, difieren: 0 }]));
  const ejemplos = [];
  let faltan = 0;
  for (const o of esc) {
    const r = nuestras.get(o.order_id);
    if (!r) { faltan++; continue; }
    for (const [k, ke] of campos) {
      tot[k].nuestro += r[k];
      tot[k].escalafy += o[ke];
      if (Math.abs(r[k] - o[ke]) > 1) {
        tot[k].difieren++;
        if (ejemplos.length < 15) ejemplos.push({ order: o.order_id, campo: k, nuestro: r[k], escalafy: r2(o[ke]), logistica: r.logistica });
      }
    }
  }
  console.log(`${esc.length} órdenes de Escalafy, ${faltan} que no encontramos, ${nuestras.size} nuestras`);
  console.table(Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, { nuestro: Math.round(v.nuestro), escalafy: Math.round(v.escalafy), dif: Math.round(v.nuestro - v.escalafy), difieren: v.difieren }])));
  console.table(ejemplos);
  process.exit(0);
}

const hasta = diaAR(new Date().toISOString());
const d0 = new Date(`${hasta}T12:00:00Z`);
d0.setUTCDate(d0.getUTCDate() - (DIAS - 1));
const desde = d0.toISOString().slice(0, 10);

const filas = await calcular(desde, hasta, costos);
const ads = await enLotes(dias(desde, hasta), 4, adsDelDia);
const COLS = ['fecha', 'order_id', 'pack_id', 'envio_id', 'logistica', 'item_id', 'variante', 'titulo', 'unidades', 'venta', 'comision', 'envio_ml', 'envio_flex', 'impuestos', 'costo', 'neto', 'sin_costo', 'flex_estimado', 'reembolsado', 'envio_devolucion', 'anulada'];
const suma = (k) => Math.round(filas.reduce((s, r) => s + r[k], 0)).toLocaleString('es-AR');
console.log(`${desde} a ${hasta}: ${filas.length} órdenes · venta ${suma('venta')} · neto ${suma('neto')} · pauta ${Math.round(ads.reduce((s, a) => s + a[1], 0)).toLocaleString('es-AR')}`);
if (DRY) process.exit(0);
const total = await guardar(sheets, TAB, [...COLS, new Date().toISOString()], filas.map((r) => COLS.map((k) => r[k])), desde, hasta);
await guardar(sheets, TAB_ADS, ['fecha', 'gasto', 'ventas_atribuidas', 'clicks', 'impresiones', new Date().toISOString()], ads, desde, hasta);
console.log(`${TAB}: ${total} filas en total`);
