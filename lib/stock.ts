import { google } from 'googleapis';
import { getAuth } from './sheets';
import { getToken } from './shopify';

// Stock del depósito (app aparte mateando-stock.vercel.app → /api/stock). Todo vive en la planilla "Costos JP - meli" de Juampi:
// - Catálogo: una pestaña por categoría (col A nombre, col F SKU maestro).
// - "Stock Movimientos": lo que cargan los chicos (Conteo, Ingreso, Salida Full, Ajuste).
// - "Stock Equivalencias": publicación de MeLi / Shopify / producto mayorista → SKUs (los completa la página).
// - stock_salidas_emp: ventas de Tienda Online + Local ya traducidas a SKU (scripts/stock-empretienda.mjs, cada hora).
// Stock = último conteo + ingresos ± ajustes − salidas a Full − ventas posteriores al conteo.
// El conteo vale "al cierre del día": se descuentan las ventas de los días siguientes.
// Ventas de MeLi por Full no se descuentan (salen del depósito de ML): se descuenta lo que se manda a Full.
export const STOCK_ID = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const NO_CATALOGO = new Set(['BASE scalify', 'Hoja 22']);
export const MOV = 'Stock Movimientos';
export const MOV_COLS = ['fecha', 'tipo', 'sku', 'producto', 'cant', 'quien', 'nota'];
export const EQ = 'Stock Equivalencias';
export const EQ_COLS = ['canal', 'clave', 'descripcion', 'skus', 'actualizado'];
export const TIPOS = ['Conteo', 'Ingreso', 'Salida Full', 'Ajuste'] as const;
export const FOTOS = 'Stock Fotos';
export const FOTOS_COLS = ['sku', 'foto', 'origen'];
const VENTANA = 30; // días para el ritmo de venta
const SKU_RX = /^[A-Z]+-[A-Z0-9]+(-[A-Z0-9]+)?$/i; // MATE-CAL-1001, y también MATE-PIEL o MATE-KIT-1L
// SKUs de las reglas / Shopify que en el Excel de Juampi tienen otro código (mismo producto). Todo en mayúsculas.
const ALIAS: Record<string, string> = { 'BOMB-ACE-12002': 'BOMB-ACE-12001', 'ACCE-ALM-10008': 'ACCE-ALM-10009', 'ACCE-KIT-10009': 'ACCE-KIT-10010' };
export const skuExcel = (s: string) => { const u = s.trim().toUpperCase(); return ALIAS[u] ?? u; };

const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const restarDias = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
export const ahoraAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

export type Producto = { sku: string; nombre: string; categoria: string };
export type Movimiento = { fila: number; fecha: string; tipo: string; sku: string; producto: string; cant: number; quien: string; nota: string };
type Venta = { dia: string; canal: string; sku: string; cant: number };
type SinTraducir = { canal: string; clave: string; descripcion: string; unidades: number };

async function asegurar(t: string, cols: string[]) {
  const s = sheets();
  const hojas = (await s.spreadsheets.get({ spreadsheetId: STOCK_ID, fields: 'sheets.properties.title' })).data.sheets?.map((h) => h.properties?.title) ?? [];
  if (hojas.includes(t)) return;
  await s.spreadsheets.batchUpdate({ spreadsheetId: STOCK_ID, requestBody: { requests: [{ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }] } });
  await s.spreadsheets.values.update({ spreadsheetId: STOCK_ID, range: `'${t}'!A1`, valueInputOption: 'RAW', requestBody: { values: [cols] } });
}
export async function agregarFilas(t: string, cols: string[], filas: (string | number)[][]) {
  await asegurar(t, cols);
  await sheets().spreadsheets.values.append({ spreadsheetId: STOCK_ID, range: `'${t}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: filas } });
}

export async function catalogo(): Promise<Producto[]> {
  const s = sheets();
  const tabs = ((await s.spreadsheets.get({ spreadsheetId: STOCK_ID, fields: 'sheets.properties.title' })).data.sheets ?? [])
    .map((h) => h.properties?.title ?? '')
    .filter((t) => t && !NO_CATALOGO.has(t) && !/^stock/i.test(t));
  const r = await s.spreadsheets.values.batchGet({ spreadsheetId: STOCK_ID, ranges: tabs.map((t) => `'${t}'!A2:F`) });
  const vistos = new Set<string>();
  const out: Producto[] = [];
  (r.data.valueRanges ?? []).forEach((vr, i) => {
    for (const f of vr.values ?? []) {
      const sku = String(f[5] ?? '').trim().toUpperCase();
      if (!SKU_RX.test(sku) || vistos.has(sku)) continue;
      vistos.add(sku);
      out.push({ sku, nombre: String(f[0] ?? '').replace(/\s+/g, ' ').trim(), categoria: tabs[i] });
    }
  });
  return out;
}

async function leer(t: string, rango: string): Promise<unknown[][]> {
  const r = await sheets().spreadsheets.values.get({ spreadsheetId: t === EMP ? EMP : STOCK_ID, range: rango, valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null);
  return r?.data.values ?? [];
}

export async function movimientos(): Promise<Movimiento[]> {
  return (await leer(STOCK_ID, `'${MOV}'!A2:G`))
    .map((f, i) => ({ fila: i + 2, fecha: String(f[0] ?? ''), tipo: String(f[1] ?? ''), sku: String(f[2] ?? '').toUpperCase(), producto: String(f[3] ?? ''), cant: Number(f[4]) || 0, quien: String(f[5] ?? ''), nota: String(f[6] ?? '') }))
    .filter((m) => m.sku && m.fecha);
}

// "SKU-A + SKU-B*2" → [[SKU-A,1],[SKU-B,2]]; "-" = no se descuenta (ej. gift card)
export function parsearSkus(txt: string): [string, number][] | null {
  const t = txt.trim().toUpperCase();
  if (!t) return null;
  if (t === '-') return [];
  const out: [string, number][] = [];
  for (const p of t.split('+')) {
    const m = p.trim().match(/^([A-Z]+-[A-Z0-9]+(?:-[A-Z0-9]+)?)\s*(?:\*\s*(\d+))?$/);
    if (!m) return null;
    out.push([m[1], Number(m[2] ?? 1)]);
  }
  return out;
}

async function equivalencias(): Promise<Map<string, [string, number][]>> {
  const m = new Map<string, [string, number][]>();
  for (const f of await leer(STOCK_ID, `'${EQ}'!A2:D`)) {
    const skus = parsearSkus(String(f[3] ?? ''));
    if (skus) m.set(`${f[0]}|${f[1]}`, skus); // la última fila de la misma clave gana
  }
  return m;
}

async function ventasShopify(desde: string) {
  const token = await getToken();
  const q = `financial_status:paid created_at:>='${desde}T00:00:00-03:00' -test:true`;
  const query = `query($q: String!, $after: String) { orders(first: 100, after: $after, query: $q) { pageInfo { hasNextPage endCursor }
    nodes { createdAt lineItems(first: 50) { nodes { sku title variantTitle currentQuantity } } } } }`;
  const out: { dia: string; sku: string; desc: string; cant: number }[] = [];
  let after: string | null = null;
  do {
    const r: Response = await fetch('https://mateando-argentina.myshopify.com/admin/api/2026-10/graphql.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables: { q, after } }), cache: 'no-store',
    });
    const d = await r.json();
    if (d.errors) throw new Error(`Shopify: ${JSON.stringify(d.errors)}`);
    for (const o of d.data.orders.nodes) {
      const dia = new Date(Date.parse(o.createdAt) - 3 * 3600e3).toISOString().slice(0, 10);
      for (const li of o.lineItems.nodes) {
        if (li.currentQuantity > 0) out.push({ dia, sku: String(li.sku ?? '').trim().toUpperCase(), desc: [li.title, li.variantTitle].filter(Boolean).join(' — '), cant: li.currentQuantity });
      }
    }
    after = d.data.orders.pageInfo.hasNextPage ? d.data.orders.pageInfo.endCursor : null;
  } while (after);
  return out;
}

async function ventas(desde: string, skus: Set<string>) {
  const eq = await equivalencias();
  const out: Venta[] = [];
  const sin = new Map<string, SinTraducir>();
  const errores: string[] = [];
  const traducir = (dia: string, canal: string, clave: string, descripcion: string, cant: number, directo?: string) => {
    const lista = eq.get(`${canal}|${clave}`) ?? (directo && skus.has(directo) ? [[directo, 1] as [string, number]] : undefined);
    if (!lista) {
      const k = `${canal}|${clave}`;
      const x = sin.get(k) ?? { canal, clave, descripcion, unidades: 0 };
      x.unidades += cant;
      sin.set(k, x);
      return;
    }
    for (const [sku, c] of lista) out.push({ dia, canal, sku: skuExcel(sku), cant: c * cant });
  };

  const [emp, meli, mayo, shop] = await Promise.all([
    leer(STOCK_ID, "'stock_salidas_emp'!A2:D"),
    leer(EMP, "'rentabilidad_meli'!A2:U"),
    leer(EMP, "'App Pedidos'!A2:T"),
    ventasShopify(desde).catch((e) => { errores.push(String(e.message ?? e)); return []; }),
  ]);
  for (const f of emp) if (String(f[0]) >= desde) out.push({ dia: String(f[0]), canal: String(f[1]), sku: skuExcel(String(f[2])), cant: Number(f[3]) || 0 });
  for (const f of meli) {
    const dia = String(f[0]);
    if (dia < desde || f[4] === 'full' || Number(f[18]) || Number(f[20])) continue;
    traducir(dia, 'MeLi', `${f[5]}|${f[6] ?? ''}`, String(f[7] ?? ''), Number(f[8]) || 0);
  }
  for (const f of mayo) {
    const dia = String(f[2] ?? '').slice(0, 10);
    if (!f[0] || dia < desde || f[19] === 'SI' || f[13] === 'Presupuesto') continue;
    let items: { nombre: string; cant: number; color?: string }[] = [];
    try { items = JSON.parse(String(f[5] || '[]')); } catch { continue; }
    for (const it of items) {
      const clave = [it.nombre, it.color].filter(Boolean).join(' | ');
      traducir(dia, 'Mayorista', clave, clave, Number(it.cant) || 0);
    }
  }
  for (const l of shop) traducir(l.dia, 'Shopify', l.sku || l.desc, l.desc, l.cant, l.sku && skuExcel(l.sku));
  const empRev = (await leer(STOCK_ID, "'stock_revisar_emp'!A2:D")).map((f) => ({ canal: `${f[0]} (regla)`, clave: '', descripcion: [f[1], f[2]].filter(Boolean).join(' — '), unidades: Number(f[3]) || 0 }));
  return { ventas: out, sinTraducir: [...sin.values(), ...empRev].sort((a, b) => b.unidades - a.unidades), errores };
}

export type FilaStock = Producto & {
  foto: string;
  conteo: { fecha: string; cant: number } | null;
  ingresos: number; ajustes: number; full: number; vendido: number; porCanal: Record<string, number>;
  stock: number | null; ritmo: number; dias: number | null; ultimoIngreso: string;
};

// Foto de cada SKU (pestaña "Stock Fotos": sku | foto | origen). Se completa con actualizarFotos(); lo que se
// cargue a mano (origen "manual" o cualquier otro que no sea automático) no se pisa.
async function fotos(): Promise<Map<string, string>> {
  return new Map((await leer(STOCK_ID, `'${FOTOS}'!A2:B`)).filter((f) => f[0] && f[1]).map((f) => [skuExcel(String(f[0])), String(f[1])]));
}

async function fotosShopify(): Promise<Map<string, string>> {
  const token = await getToken();
  const query = `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor }
    nodes { sku media(first: 1) { nodes { preview { image { url(transform: {maxWidth: 240}) } } } }
      product { featuredMedia { preview { image { url(transform: {maxWidth: 240}) } } } } } } }`;
  const out = new Map<string, string>();
  let after: string | null = null;
  do {
    const r: Response = await fetch('https://mateando-argentina.myshopify.com/admin/api/2026-10/graphql.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables: { after } }), cache: 'no-store',
    });
    const d = await r.json();
    if (d.errors) throw new Error(`Shopify fotos: ${JSON.stringify(d.errors).slice(0, 300)}`);
    for (const v of d.data.productVariants.nodes) {
      if (!v.sku) continue;
      const url = v.media?.nodes?.[0]?.preview?.image?.url ?? v.product?.featuredMedia?.preview?.image?.url;
      const k = skuExcel(v.sku);
      if (url && (!out.has(k) || v.media?.nodes?.length)) out.set(k, url); // la foto de la variante le gana a la del producto
    }
    after = d.data.productVariants.pageInfo.hasNextPage ? d.data.productVariants.pageInfo.endCursor : null;
  } while (after);
  return out;
}

export async function actualizarFotos() {
  const [cat, previas, shop] = await Promise.all([catalogo(), leer(STOCK_ID, `'${FOTOS}'!A2:C`), fotosShopify()]);
  const manual = new Map(previas.filter((f) => f[0] && f[1] && f[2] !== 'shopify').map((f) => [skuExcel(String(f[0])), [String(f[1]), String(f[2] || 'manual')]]));
  const filas = cat.map((p) => manual.has(p.sku) ? [p.sku, ...manual.get(p.sku)!] : shop.has(p.sku) ? [p.sku, shop.get(p.sku)!, 'shopify'] : [p.sku, '', '']);
  await asegurar(FOTOS, FOTOS_COLS);
  await sheets().spreadsheets.values.clear({ spreadsheetId: STOCK_ID, range: `'${FOTOS}'!A2:C` });
  await sheets().spreadsheets.values.update({ spreadsheetId: STOCK_ID, range: `'${FOTOS}'!A2`, valueInputOption: 'RAW', requestBody: { values: filas } });
  return { total: filas.length, conFoto: filas.filter((f) => f[1]).length, sinFoto: filas.filter((f) => !f[1]).map((f) => f[0]) };
}

export async function resumen() {
  const hoy = hoyAR();
  const [cat, movs, fts] = await Promise.all([catalogo(), movimientos(), fotos()]);
  const conteos = new Map<string, Movimiento>();
  for (const m of movs) if (m.tipo === 'Conteo' && (!conteos.has(m.sku) || m.fecha >= conteos.get(m.sku)!.fecha)) conteos.set(m.sku, m);
  const primerConteo = [...conteos.values()].reduce((d, m) => (m.fecha.slice(0, 10) < d ? m.fecha.slice(0, 10) : d), hoy);
  const desde = [primerConteo, restarDias(hoy, VENTANA)].sort()[0];
  const skus = new Set(cat.map((p) => p.sku));
  const v = await ventas(desde, skus);
  const desdeRitmo = restarDias(hoy, VENTANA);

  const filas: FilaStock[] = cat.map((p) => {
    const c = conteos.get(p.sku);
    const despues = (m: Movimiento) => m.sku === p.sku && (!c || m.fecha > c.fecha);
    let ingresos = 0, ajustes = 0, full = 0, ultimoIngreso = '';
    for (const m of movs) {
      if (!despues(m)) continue;
      if (m.tipo === 'Ingreso') { ingresos += m.cant; if (m.fecha > ultimoIngreso) ultimoIngreso = m.fecha; }
      else if (m.tipo === 'Ajuste') ajustes += m.cant;
      else if (m.tipo === 'Salida Full') full += m.cant;
    }
    const porCanal: Record<string, number> = {};
    let vendido = 0, enVentana = 0;
    for (const x of v.ventas) {
      if (x.sku !== p.sku) continue;
      if (x.dia > desdeRitmo) enVentana += x.cant;
      if (c && x.dia > c.fecha.slice(0, 10)) { vendido += x.cant; porCanal[x.canal] = (porCanal[x.canal] ?? 0) + x.cant; }
    }
    const ritmo = enVentana / VENTANA;
    const stock = c ? c.cant + ingresos + ajustes - full - vendido : null;
    return { ...p, foto: fts.get(p.sku) ?? '', conteo: c ? { fecha: c.fecha, cant: c.cant } : null, ingresos, ajustes, full, vendido, porCanal, stock, ritmo,
      dias: stock != null && ritmo > 0 ? Math.floor(Math.max(0, stock) / ritmo) : null, ultimoIngreso };
  });
  return { actualizado: ahoraAR(), filas, ultimos: movs.slice(-40).reverse(), sinTraducir: v.sinTraducir.slice(0, 150), errores: v.errores };
}
