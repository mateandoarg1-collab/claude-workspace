import { google } from 'googleapis';
import { getOrdenes, ACORDAR, PAGO } from './empretiendaOrdenes';
import { getAuth } from './sheets';
import { getShopifyLineas } from './shopify';
import { mlFetch, ML_USER_ID, isValidOrder, fmtTZ, type MLOrder } from './ml';
import { factor, FACTORES, eventosDel, iso, NOMBRE_EVENTO, sumarDias, type Ajustes, type Evento } from './chinaProyeccion';

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

// --- Stock en Full ahora, en piezas, y la foto de portada de la publicación de cada pieza.
async function stockFull(): Promise<{ stock: Record<string, number>; fotos: Record<string, string> }> {
  const ids = Object.values(FULL).flatMap((d) => Object.values(d));
  const inv = new Map<string, string>();
  const portada = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 20) {
    const r = await ml<Array<{ body: { id: string; inventory_id?: string; thumbnail_id?: string } }>>(
      `/items?ids=${ids.slice(i, i + 20).join(',')}&attributes=id,inventory_id,thumbnail_id`,
    );
    for (const x of r) {
      if (x.body?.inventory_id) inv.set(x.body.id, x.body.inventory_id);
      if (x.body?.thumbnail_id) portada.set(x.body.id, `https://http2.mlstatic.com/D_${x.body.thumbnail_id}-O.jpg`);
    }
  }
  const fotos: Record<string, string> = {};
  for (const [prod, colores] of Object.entries(FULL)) {
    if (prod.startsWith('Set')) continue; // la foto es la de la pieza suelta, no la del kit
    for (const [c, id] of Object.entries(colores)) if (portada.has(id)) fotos[`${prod}|${c}`] = portada.get(id)!;
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
  return { stock: out, fotos };
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

const VENTANA = 30; // días del promedio por canal que muestra cada tarjeta
const MEDIA_VIDA = 30; // el ritmo usa toda la historia: una venta de hace 30 días pesa la mitad que una de ayer
const HORIZONTE_PRUEBA = 7; // días que se pronostican en cada prueba contra el historial
// El ritmo se aprende desde el 1/10: en septiembre todavía se estaba lanzando (colores nuevos llegando, publicaciones
// nuevas de MeLi del 30/9) y se vendía la mitad; usarlo hacía que todo pareciera crecer y exageraba las fechas fuertes.
const DESDE_RITMO = '2026-10-01';

const entre = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
function dias(desde: string, hasta: string): string[] {
  const out: string[] = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) out.push(d);
  return out;
}

// Ritmo de un día normal (sin fechas fuertes) con todas las ventas minoristas desde el 1/10 hasta `hasta`: cada día
// se divide por su factor de fecha fuerte y pesa menos cuanto más viejo es.
function ritmoBase(porDia: Map<string, number>, hasta: string, ajustes: Ajustes): number {
  let num = 0;
  let den = 0;
  for (const d of dias(DESDE_RITMO, hasta)) {
    const w = 0.5 ** (entre(hasta, d) / MEDIA_VIDA);
    num += (porDia.get(d) ?? 0) * w;
    den += factor(d, ajustes) * w;
  }
  return den > 0 ? num / den : 0;
}

export type Aprendido = { evento: Evento; nombre: string; supuesto: number; medido: number; dias: number; desde: string; hasta: string };

// Cuánto se vendió de verdad en cada fecha fuerte que ya pasó, contra el ritmo normal de antes. Solo días con un
// único evento (para no mezclar efectos), la última vez que ocurrió, mínimo 3 días y 5 de historia previa.
function aprenderFactores(porDia: Map<string, number>, hasta: string): Aprendido[] {
  const grupos = new Map<Evento, string[]>();
  for (const d of dias(DESDE_RITMO, hasta)) {
    const ev = eventosDel(d);
    if (ev.length === 1) grupos.set(ev[0], [...(grupos.get(ev[0]) ?? []), d]);
  }
  const out: Aprendido[] = [];
  for (const [evento, ds] of grupos) {
    const bloque = [ds[ds.length - 1]];
    for (let j = ds.length - 2; j >= 0 && entre(bloque[0], ds[j]) === 1; j--) bloque.unshift(ds[j]);
    const antes = sumarDias(bloque[0], -1);
    if (bloque.length < 3 || entre(antes, DESDE_RITMO) < 4) continue;
    const base = ritmoBase(porDia, antes, {});
    if (base <= 0) continue;
    const real = bloque.reduce((s, d) => s + (porDia.get(d) ?? 0), 0);
    out.push({
      evento,
      nombre: NOMBRE_EVENTO[evento],
      supuesto: FACTORES[evento],
      medido: Math.min(6, Math.max(0.3, real / (base * bloque.length))),
      dias: bloque.length,
      desde: bloque[0],
      hasta: bloque[bloque.length - 1],
    });
  }
  return out;
}
const comoAjustes = (a: Aprendido[]): Ajustes => Object.fromEntries(a.map((x) => [x.evento, x.medido]));

export type Prueba = { corte: string; pronostico: number; real: number };

// Prueba contra el historial: parado en cada fecha pasada (una por semana), pronostica la semana siguiente con lo
// que se sabía hasta ese día y lo compara con lo que se vendió. Ventas minoristas de todos los productos juntos.
function probar(porDia: Map<string, number>, ayer: string): Prueba[] {
  const out: Prueba[] = [];
  for (let corte = sumarDias(DESDE_RITMO, 6); sumarDias(corte, HORIZONTE_PRUEBA) <= ayer; corte = sumarDias(corte, 7)) {
    const ajustes = comoAjustes(aprenderFactores(porDia, corte));
    const base = ritmoBase(porDia, corte, ajustes);
    let pronostico = 0;
    let real = 0;
    for (let i = 1; i <= HORIZONTE_PRUEBA; i++) {
      const d = sumarDias(corte, i);
      pronostico += base * factor(d, ajustes);
      real += porDia.get(d) ?? 0;
    }
    out.push({ corte, pronostico: Math.round(pronostico), real });
  }
  return out;
}

export type Fila = {
  producto: string;
  color: string;
  llegaron: number;
  vendidos: number;
  porCanal: Record<Canal, number>;
  stock: number | null; // conteo físico − ventas desde el conteo
  full: number;
  foto: string | null; // portada de la publicación de MeLi
  porDia: number; // minoristas (MeLi, web, local, Shopify): promedio de los últimos 30 días
  porDiaCanal: Record<Canal, number>; // minoristas, últimos 30 días (Mayorista queda en 0: va aparte)
  base: number; // ritmo minorista de un día "normal" (sin fechas fuertes): define el quiebre
  mayoristaDia: number; // promedio mayorista desde el 1/9: solo para el pedido sugerido
  tendencia: number | null; // minoristas, últimos 7 días vs los 7 anteriores
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
    seguro('Stock Full', stockFull(), { stock: {} as Record<string, number>, fotos: {} as Record<string, string> }),
    seguro('Conteo', ultimoConteo(), null),
  ]);
  const ventas = [...emp, ...shop, ...may, ...meli];
  const hoy = iso(new Date(Date.now() - 3 * 3600e3));
  const ayer = sumarDias(hoy, -1);
  const desdeVentana = sumarDias(hoy, -VENTANA);
  const desde7 = sumarDias(hoy, -7);
  const desde14 = sumarDias(hoy, -14);
  // Mayorista (pedidos grandes y sueltos): descuenta del stock pero no define el quiebre; para el pedido sugerido se
  // suma su promedio desde el 1/9.
  const diasMayorista = Math.max(1, entre(ayer, DESDE) + 1);

  // Ventas minoristas por día (todos los productos): de acá salen las fechas fuertes medidas y las pruebas.
  const minorista = ventas.filter((v) => v.canal !== 'Mayorista' && v.dia <= ayer);
  const totalDia = new Map<string, number>();
  for (const v of minorista) totalDia.set(v.dia, (totalDia.get(v.dia) ?? 0) + v.q);
  const aprendido = aprenderFactores(totalDia, ayer);
  const ajustes = comoAjustes(aprendido);
  const pruebas = probar(totalDia, ayer);

  const cero = () => Object.fromEntries(CANALES.map((c) => [c, 0])) as Record<Canal, number>;
  const canales = cero();
  for (const v of ventas) canales[v.canal] += v.q;

  const filas: Fila[] = Object.keys(LLEGARON).map((k) => {
    const [producto, c] = k.split('|');
    const mias = ventas.filter((v) => v.k === k);
    const porCanal = cero();
    const porDiaCanal = cero();
    const minoristaDia = new Map<string, number>();
    let sem = 0;
    let semAnt = 0;
    for (const v of mias) {
      porCanal[v.canal] += v.q;
      if (v.dia > ayer) continue;
      if (v.canal === 'Mayorista') continue; // descuenta stock (más abajo), pero no entra en el ritmo
      minoristaDia.set(v.dia, (minoristaDia.get(v.dia) ?? 0) + v.q);
      if (v.dia >= desdeVentana) porDiaCanal[v.canal] += v.q / VENTANA;
      if (v.dia >= desde7) sem += v.q;
      else if (v.dia >= desde14) semAnt += v.q;
    }
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
      full: full.stock[k] ?? 0,
      foto: full.fotos[k] ?? null,
      porDia: CANALES.reduce((s, x) => s + porDiaCanal[x], 0),
      porDiaCanal,
      base: ritmoBase(minoristaDia, ayer, ajustes),
      mayoristaDia: porCanal.Mayorista / diasMayorista,
      tendencia: semAnt > 0 ? sem / semAnt - 1 : null,
    };
  });

  const sinColor = ventas.filter((v) => v.k.endsWith('|?')).reduce((s, v) => s + v.q, 0);
  return {
    generado: new Date().toISOString(),
    desde: DESDE,
    hoy,
    conteo: conteo?.fecha ?? null,
    canales,
    total: ventas.reduce((s, v) => s + v.q, 0),
    porDia: filas.reduce((s, f) => s + f.porDia, 0),
    sinColor,
    diasHistoria: entre(ayer, DESDE_RITMO) + 1,
    desdeRitmo: DESDE_RITMO,
    diario: dias(DESDE, ayer).map((d) => ({
      dia: d,
      minorista: totalDia.get(d) ?? 0,
      mayorista: ventas.filter((v) => v.canal === 'Mayorista' && v.dia === d).reduce((s, v) => s + v.q, 0),
    })),
    ajustes,
    aprendido,
    pruebas,
    errores,
    filas,
  };
}
