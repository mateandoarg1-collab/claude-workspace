import { google } from 'googleapis';
import { getOrdenes, ACORDAR, PAGO } from './empretiendaOrdenes';
import { getAuth } from './sheets';
import { getShopifyLineas } from './shopify';
import { mlFetch, ML_USER_ID, isValidOrder, fmtTZ, type MLOrder } from './ml';
import { factor, iso, sumarDias } from './chinaProyeccion';

// Productos importados de China (container que llegó en sep-2026): ventas de todos los canales desde el 1/9 y stock
// en vivo. Los kits se desarman en piezas (Set 1 L = Termo 1 L + Mate; Set 750 = Termo 750 + Mate), porque lo que se
// sigue es cuánto queda de cada pieza del container. Misma lógica que scripts/china-stock.py.
//
// Stock actual = último conteo físico (pestaña china_conteo: Full + Local + depósito Paraguay) − todo lo vendido desde
// el día siguiente al conteo. Para actualizarlo se agregan filas con fecha nueva en esa pestaña.

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
export const DESDE = '2026-09-01';

export const PRODUCTOS = ['Autocebante', 'Termo 1 L', 'Termo 750', 'Mate Acero 236'] as const;
export const COLORES = ['Negro', 'Rosa', 'Beige', 'Blanco'] as const;
export type Canal = 'MeLi' | 'Empre' | 'Local' | 'Shopify' | 'Mayorista';
export const CANALES: Canal[] = ['MeLi', 'Empre', 'Local', 'Shopify', 'Mayorista'];

// Lo que llegó en el container, por pieza.
export const LLEGARON: Record<string, number> = {
  'Autocebante|Negro': 4500, 'Autocebante|Rosa': 1500, 'Autocebante|Blanco': 500,
  'Termo 1 L|Negro': 500, 'Termo 1 L|Rosa': 4500, 'Termo 1 L|Beige': 1500, 'Termo 1 L|Blanco': 500,
  'Termo 750|Negro': 1000, 'Termo 750|Rosa': 1500, 'Termo 750|Beige': 700, 'Termo 750|Blanco': 500,
  'Mate Acero 236|Negro': 500, 'Mate Acero 236|Rosa': 1000, 'Mate Acero 236|Beige': 600, 'Mate Acero 236|Blanco': 500,
};

// family_id de MeLi → piezas que lleva cada venta.
const FAMILIAS: Record<number, string[]> = {
  6990630313309266: ['Autocebante'],
  1127462538336336: ['Mate Acero 236'],
  7376544667388880: ['Termo 1 L', 'Mate Acero 236'],
  5506649408378769: ['Termo 750', 'Mate Acero 236'],
  6585242783220880: ['Termo 1 L'],
  3923350767025297: ['Termo 750'],
};

// Publicaciones de MeLi en Full de cada pieza (los Sets aportan termo + mate).
const FULL: Record<string, Record<string, string>> = {
  Autocebante: { Negro: 'MLA2562034074', Rosa: 'MLA3974929628', Blanco: 'MLA3974809178' },
  'Termo 1 L': { Negro: 'MLA2562099492', Rosa: 'MLA2562190470', Beige: 'MLA4010391580', Blanco: 'MLA1580171259' },
  'Termo 750': { Negro: 'MLA1580170603', Rosa: 'MLA1580183657', Beige: 'MLA2101246099', Blanco: 'MLA1580158225' },
  'Set 1 L': { Negro: 'MLA2120704729', Rosa: 'MLA2120716985', Beige: 'MLA2120704727', Blanco: 'MLA2120693129' },
  'Set 750': { Negro: 'MLA3988529826', Rosa: 'MLA3988388754', Beige: 'MLA3988542778', Blanco: 'MLA3988517444' },
  'Mate Acero 236': { Negro: 'MLA2121021715', Rosa: 'MLA3988928818', Beige: 'MLA3988928820', Blanco: 'MLA2121021713' },
};

export function color(s: string | null | undefined): string {
  const t = (s ?? '').toUpperCase();
  // Rosa al final: "NEGROS" (mayorista) contiene "ROS".
  if (/NEGR|BLACK/.test(t)) return 'Negro';
  if (/BLANC|WHITE/.test(t)) return 'Blanco';
  if (/BEIGE/.test(t)) return 'Beige';
  if (/ROS|PINK/.test(t)) return 'Rosa';
  return '?';
}

// Venta de una pieza: producto|color, canal y día AR.
type Venta = { k: string; canal: Canal; dia: string; q: number };
const diaAR = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 10);

// --- Empretienda (web) y Local ("Acordar"): emp_ordenes trae id:cantidad y emp_productos el nombre. El color de las
// variantes no viaja en la orden: va en el nombre salvo en algún mate Flow personalizado (queda sin color).
export function piezasEmpretienda(nombre: string): string[] {
  const n = nombre.toUpperCase();
  if (n.includes('AUTOCEBANTE')) return [`Autocebante|${color(n)}`];
  const kit = n.match(/KIT MATERO MATEANDO - TERMO (1 L|750)/);
  if (kit) return [`${kit[1] === '750' ? 'Termo 750' : 'Termo 1 L'}|${color(n)}`, `Mate Acero 236|${color(n)}`];
  if (/KIT MATERO (CAPRI|TOTE) TERMO Y MATE (ACERO )?BEIGE/.test(n)) return ['Termo 1 L|Beige', 'Mate Acero 236|Beige'];
  if (/KIT MATERO (CAPRI|TOTE) TERMO Y MATE ROSE/.test(n)) return ['Termo 1 L|Rosa']; // el mate es ranchero
  if (/KIT MATERO TOTE TERMO 1 LT/.test(n)) return ['Termo 1 L|?'];
  if (/TERMO (\w+ )?MATEANDO/.test(n) && n.includes('SET')) {
    // Sets con mate ranchero/imperial: solo el termo es chino. El color es el del termo (lo que sigue a "TERMO").
    const tam = n.includes('750') ? 'Termo 750' : 'Termo 1 L';
    let c = n.includes('VACA RANCHERO BLACK') ? 'Negro' : color(n.slice(n.indexOf('TERMO')));
    if (c === '?') c = color(n);
    if (c === '?' && tam === 'Termo 750' && n.includes('BOMBILLA PICO LORO')) c = 'Blanco';
    return [`${tam}|${c}`];
  }
  if (n.includes('TERMO MATEANDO CLASSIC 1')) return [`Termo 1 L|${color(n)}`];
  if (n.includes('TERMO MATEANDO SLIM 750')) return [`Termo 750|${color(n)}`];
  if (n.includes('FLOW DE ACERO TERMICO 236')) return [`Mate Acero 236|${color(n)}`];
  return [];
}

async function ventasEmpretienda(): Promise<Venta[]> {
  const { ordenes, productos } = await getOrdenes();
  const nombre = new Map(productos.map((p) => [p.id, p.nombre]));
  const out: Venta[] = [];
  for (const o of ordenes) {
    if (o.pago !== PAGO.pagada || o.dia < DESDE) continue;
    const canal: Canal = o.metodo === ACORDAR ? 'Local' : 'Empre';
    for (const p of o.productos) {
      for (const k of piezasEmpretienda(nombre.get(p.id) ?? '')) out.push({ k, canal, dia: o.dia, q: p.cant });
    }
  }
  return out;
}

// --- Shopify: solo pedidos pagados.
export function piezasShopify(title: string, variant: string | null): string[] {
  if (/autocebante/i.test(title)) return [`Autocebante|${color(variant ?? title)}`];
  if (/Termo Mateando Classic/i.test(title)) {
    // "Classic 1 Litro" sin variante es la publicación vieja, que era solo rosa.
    const c = variant ? color(variant) : /rose/i.test(title) ? 'Rosa' : 'Rosa';
    return [`Termo 1 L|${c}`];
  }
  if (/Termo Mateando 750ml Slim/i.test(title)) return [`Termo 750|${color(variant)}`];
  if (/Flow de Acero/i.test(title)) return [`Mate Acero 236|${color(variant)}`];
  return [];
}

async function ventasShopify(): Promise<Venta[]> {
  const lineas = await getShopifyLineas(DESDE);
  return lineas.flatMap((l) => piezasShopify(l.title, l.variant).map((k) => ({ k, canal: 'Shopify' as Canal, dia: l.dia, q: l.cant })));
}

// --- Mayorista: planilla MATEANDO MAYORISTA 2026, una pestaña por mes ("OCT 26", "SEPT 26"). Producto en texto libre
// ("autocebantes negros", "termos mateando 1L rosas"); la fecha dd/mm va solo en la 1ª fila de cada pedido.
const MESES: Record<string, number> = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DIC: 12 };

export function piezasMayorista(texto: string): string[] {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/autoceb/.test(t)) return [`Autocebante|${color(t)}`];
  if (/flow/.test(t)) return [`Mate Acero 236|${color(t)}`];
  if (/termo/.test(t) && /m\w*eando/.test(t) && !/manija|stanley|system|caja/.test(t)) {
    if (/750/.test(t)) return [`Termo 750|${color(t)}`];
    if (/1\s*l\b|1l|litro|1000/.test(t)) return [`Termo 1 L|${color(t)}`];
  }
  return [];
}

async function ventasMayorista(): Promise<Venta[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  const tabs = (meta.data.sheets ?? [])
    .map((s) => s.properties?.title ?? '')
    .map((t) => ({ t, m: t.trim().match(/^([A-Z]+)\.? (\d{2})$/) }))
    .filter((x) => x.m && MESES[x.m[1]])
    .map((x) => ({ tab: x.t, anio: 2000 + Number(x.m![2]), mes: MESES[x.m![1]] }))
    .filter((x) => `${x.anio}-${String(x.mes).padStart(2, '0')}` >= DESDE.slice(0, 7));
  if (!tabs.length) return [];
  const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SPREADSHEET_ID, ranges: tabs.map((x) => `'${x.tab}'!A3:D`) });
  const out: Venta[] = [];
  (r.data.valueRanges ?? []).forEach((vr, i) => {
    const { anio, mes } = tabs[i];
    let dia = '';
    for (const row of vr.values ?? []) {
      const f = String(row[0] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})$/);
      if (f) dia = `${anio}-${f[2].padStart(2, '0')}-${f[1].padStart(2, '0')}`;
      const q = Number(String(row[2] ?? '').trim());
      if (!dia || !q || Number(f?.[2] ?? mes) !== mes) continue;
      for (const k of piezasMayorista(String(row[3] ?? ''))) out.push({ k, canal: 'Mayorista', dia, q });
    }
  });
  return out;
}

// --- MeLi: órdenes pagadas desde el 1/9, en tramos de 10 días en paralelo (cada búsqueda corta en 10.000 de offset).
async function ml<T>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await mlFetch<T>(path);
    } catch (e) {
      if (i >= 4 || !String(e).includes(' 429 ')) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i)); // MeLi limita pedidos por minuto
    }
  }
}

async function ordenesMeli(): Promise<MLOrder[]> {
  const tramos: Array<[Date, Date]> = [];
  const fin = new Date();
  for (let a = new Date(`${DESDE}T00:00:00-03:00`); a < fin; a = new Date(a.getTime() + 10 * 864e5)) {
    tramos.push([a, new Date(Math.min(a.getTime() + 10 * 864e5 - 1000, fin.getTime()))]);
  }
  const lotes = await Promise.all(
    tramos.map(async ([from, to]) => {
      const out: MLOrder[] = [];
      for (let offset = 0; offset < 10000; offset += 50) {
        const q = new URLSearchParams({
          seller: ML_USER_ID(),
          'order.date_created.from': fmtTZ(from),
          'order.date_created.to': fmtTZ(to),
          sort: 'date_desc',
          limit: '50',
          offset: String(offset),
        });
        const d = await ml<{ results: MLOrder[] }>(`/orders/search?${q}`);
        out.push(...d.results);
        if (d.results.length < 50) break;
      }
      return out;
    }),
  );
  return lotes.flat().filter(isValidOrder);
}

async function ventasMeli(): Promise<Venta[]> {
  const ordenes = await ordenesMeli();
  const ids = [...new Set(ordenes.flatMap((o) => o.order_items.map((it) => it.item.id)))];
  const meta = new Map<string, { familia: number | null; color: string | null }>();
  for (let i = 0; i < ids.length; i += 20) {
    const r = await ml<Array<{ code: number; body: { id: string; family_id?: number | null; attributes?: Array<{ id: string; value_name: string | null }> } }>>(
      `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,family_id,attributes`,
    );
    for (const x of r) {
      if (x.code !== 200 || !x.body) continue;
      meta.set(x.body.id, { familia: x.body.family_id ?? null, color: x.body.attributes?.find((a) => a.id === 'COLOR')?.value_name ?? null });
    }
  }
  const out: Venta[] = [];
  for (const o of ordenes) {
    const dia = diaAR(o.date_created);
    for (const it of o.order_items) {
      const m = meta.get(it.item.id);
      const piezas = m?.familia != null ? FAMILIAS[m.familia] : undefined;
      if (!piezas) continue;
      const c = color(it.item.variation_attributes?.find((a) => a.id === 'COLOR')?.value_name ?? m?.color);
      for (const p of piezas) out.push({ k: `${p}|${c}`, canal: 'MeLi', dia, q: it.quantity });
    }
  }
  return out;
}

// --- Stock en Full ahora, en piezas.
async function stockFull(): Promise<Record<string, number>> {
  const ids = Object.values(FULL).flatMap((d) => Object.values(d));
  const inv = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 20) {
    const r = await ml<Array<{ body: { id: string; inventory_id?: string } }>>(`/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,inventory_id`);
    for (const x of r) if (x.body?.inventory_id) inv.set(x.body.id, x.body.inventory_id);
  }
  const out: Record<string, number> = {};
  const sumar = (k: string, q: number) => (out[k] = (out[k] ?? 0) + q);
  await Promise.all(
    Object.entries(FULL).flatMap(([prod, colores]) =>
      Object.entries(colores).map(async ([c, id]) => {
        const i = inv.get(id);
        const q = i ? (await ml<{ available_quantity: number }>(`/inventories/${i}/stock/fulfillment`)).available_quantity : 0;
        if (prod === 'Set 1 L') { sumar(`Termo 1 L|${c}`, q); sumar(`Mate Acero 236|${c}`, q); }
        else if (prod === 'Set 750') { sumar(`Termo 750|${c}`, q); sumar(`Mate Acero 236|${c}`, q); }
        else sumar(`${prod}|${c}`, q);
      }),
    ),
  );
  return out;
}

// --- Último conteo físico (pestaña china_conteo: fecha | producto | color | full | local | deposito).
type Conteo = { fecha: string; stock: Record<string, { full: number; local: number; deposito: number }> };
async function ultimoConteo(): Promise<Conteo | null> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'china_conteo'!A2:F", valueRenderOption: 'UNFORMATTED_VALUE' });
  const filas = (r.data.values ?? []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x[0])));
  if (!filas.length) return null;
  const fecha = filas.map((x) => String(x[0])).sort().at(-1)!;
  const stock: Conteo['stock'] = {};
  for (const x of filas.filter((x) => String(x[0]) === fecha)) {
    stock[`${x[1]}|${x[2]}`] = { full: Number(x[3]) || 0, local: Number(x[4]) || 0, deposito: Number(x[5]) || 0 };
  }
  return { fecha, stock };
}

const VENTANA = 14; // días completos para medir el ritmo

export type Fila = {
  producto: string;
  color: string;
  llegaron: number;
  vendidos: number;
  porCanal: Record<Canal, number>;
  stock: number | null; // conteo físico − ventas desde el conteo
  full: number;
  porDia: number; // promedio de los últimos 14 días
  porDiaCanal: Record<Canal, number>;
  base: number; // ritmo de un día "normal" (sin fechas fuertes) para proyectar
  tendencia: number | null; // últimos 7 días vs los 7 anteriores
};

export async function getChina() {
  // Si una fuente falla, el resto se muestra igual y la página avisa cuál faltó.
  const errores: string[] = [];
  const seguro = <T,>(nombre: string, p: Promise<T>, vacio: T) =>
    p.catch((e) => {
      errores.push(`${nombre}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
      return vacio;
    });
  const [emp, shop, may, meli, full, conteo] = await Promise.all([
    seguro('Empretienda', ventasEmpretienda(), []),
    seguro('Shopify', ventasShopify(), []),
    seguro('Mayorista', ventasMayorista(), []),
    seguro('Mercado Libre', ventasMeli(), []),
    seguro('Stock Full', stockFull(), {} as Record<string, number>),
    seguro('Conteo', ultimoConteo(), null),
  ]);
  const ventas = [...emp, ...shop, ...may, ...meli];
  const hoy = iso(new Date(Date.now() - 3 * 3600e3));
  const ayer = sumarDias(hoy, -1);
  const desde14 = sumarDias(hoy, -VENTANA);
  const desde7 = sumarDias(hoy, -7);
  // Ritmo normalizado: ventas de los últimos 14 días completos ÷ suma de factores de esos días.
  let sumaFactores = 0;
  for (let i = VENTANA; i >= 1; i--) sumaFactores += factor(sumarDias(hoy, -i));

  const cero = () => Object.fromEntries(CANALES.map((c) => [c, 0])) as Record<Canal, number>;
  const canales = cero();
  for (const v of ventas) canales[v.canal] += v.q;

  const filas: Fila[] = Object.keys(LLEGARON).map((k) => {
    const [producto, c] = k.split('|');
    const mias = ventas.filter((v) => v.k === k);
    const porCanal = cero();
    const porDiaCanal = cero();
    let sem = 0;
    let semAnt = 0;
    for (const v of mias) {
      porCanal[v.canal] += v.q;
      if (v.dia >= desde14 && v.dia <= ayer) {
        porDiaCanal[v.canal] += v.q / VENTANA;
        if (v.dia >= desde7) sem += v.q;
        else semAnt += v.q;
      }
    }
    const ultimos = sem + semAnt;
    let stock: number | null = null;
    const enConteo = conteo?.stock[k];
    if (conteo && enConteo) {
      const despues = mias.filter((v) => v.dia > conteo.fecha).reduce((s, v) => s + v.q, 0);
      stock = Math.max(0, enConteo.full + enConteo.local + enConteo.deposito - despues);
    }
    return {
      producto,
      color: c,
      llegaron: LLEGARON[k],
      vendidos: mias.reduce((s, v) => s + v.q, 0),
      porCanal,
      stock,
      full: full[k] ?? 0,
      porDia: ultimos / VENTANA,
      porDiaCanal,
      base: ultimos / sumaFactores,
      tendencia: semAnt > 0 ? sem / semAnt - 1 : null,
    };
  });

  const sinColor = ventas.filter((v) => v.k.endsWith('|?')).reduce((s, v) => s + v.q, 0);
  const ultimos14 = ventas.filter((v) => v.dia >= desde14 && v.dia <= ayer).reduce((s, v) => s + v.q, 0);
  return {
    generado: new Date().toISOString(),
    desde: DESDE,
    hoy,
    conteo: conteo?.fecha ?? null,
    canales,
    total: ventas.reduce((s, v) => s + v.q, 0),
    porDia: ultimos14 / VENTANA,
    sinColor,
    errores,
    filas,
  };
}
