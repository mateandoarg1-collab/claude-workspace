// Costos de Mercado Libre que antes se cargaban en Escalafy, ahora en la planilla MATEANDO MAYORISTA 2026:
// - costos_meli: costo actual por publicación / variación (lo leen scripts/meli-rentabilidad.mjs y /api/ml/periodo).
// - costos_meli_historial: costos que ya no rigen, con su período, para valorar las ventas viejas.
// - costos_adicionales: costos fuera de la orden (fijos por mes o variables), que restan en la ganancia final.
import { google } from 'googleapis';
import { getAuth } from './sheets';
import { mlFetch, ML_USER_ID } from './ml';
import type { BaseVariable, CostoAdicional } from './costosAdicionales';

export { adicionalDelDia, type CostoAdicional } from './costosAdicionales';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

// ---------- Costos adicionales ----------


// Los que estaban en Escalafy, para arrancar si la pestaña todavía no existe.
const INICIALES: CostoAdicional[] = [
  { nombre: 'Pichón', tipo: 'variable', monto: 2, base: 'venta_con_iva_menos_ads', desde: '2026-10-01', hasta: '' },
  { nombre: 'Nubimetrics', tipo: 'fijo', monto: 101035, base: '', desde: '2025-09-01', hasta: '' },
];
const TAB_ADICIONALES = 'costos_adicionales';

export async function getCostosAdicionales(): Promise<CostoAdicional[]> {
  const res = await sheets()
    .spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ADICIONALES}'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  if (!res) return INICIALES;
  return (res.data.values ?? [])
    .filter((r) => String(r[0] ?? '').trim())
    .map((r) => ({
      nombre: String(r[0]).trim(),
      tipo: r[1] === 'variable' ? 'variable' : 'fijo',
      monto: Number(r[2]) || 0,
      base: (['venta', 'venta_con_iva_menos_ads', 'pedido'].includes(String(r[3])) ? r[3] : '') as BaseVariable | '',
      desde: String(r[4] ?? ''),
      hasta: String(r[5] ?? ''),
    }));
}

export async function setCostosAdicionales(lista: CostoAdicional[]) {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const hoja = meta.data.sheets?.find((h) => h.properties?.title === TAB_ADICIONALES);
  if (!hoja) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB_ADICIONALES } } }] } });
  }
  const filas = lista.map((c) => [c.nombre, c.tipo, c.monto, c.tipo === 'variable' ? c.base : '', c.desde, c.hasta]);
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB_ADICIONALES}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['nombre', 'tipo', 'monto', 'base', 'desde', 'hasta', new Date().toISOString()], ...filas] },
  });
  const total = hoja?.properties?.gridProperties?.rowCount ?? 0;
  if (total > filas.length + 1) {
    await s.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB_ADICIONALES}'!A${filas.length + 2}:G${total}` });
  }
}

// ---------- Costo de producto por publicación ----------

type FilaCosto = { fila: number; item: string; variante: string; tipo: string; costo: number; nombre: string };

// La clave es la publicación, o publicación + variación. En la planilla una publicación sin variaciones
// lleva su propio id como variante (así lo exportaba Escalafy).
const clave = (item: string, variante?: string | null) => (variante && variante !== item ? `${item}|${variante}` : item);

async function leerCostos(): Promise<FilaCosto[]> {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'costos_meli'!A2:E`, valueRenderOption: 'UNFORMATTED_VALUE' });
  return (res.data.values ?? []).map((r, i) => ({
    fila: i + 2,
    item: String(r[0] ?? ''),
    variante: String(r[1] ?? ''),
    tipo: String(r[2] ?? ''),
    costo: Number(r[3]) || 0,
    nombre: String(r[4] ?? ''),
  }));
}

export type Publicacion = {
  item_id: string; variant_id: string | null; titulo: string; variante: string | null; foto: string | null;
  costo: number | null; activa: boolean; vendidas30: number; sinCosto30: number;
};

type ItemML = {
  id: string; title: string; secure_thumbnail?: string; thumbnail?: string;
  variations?: Array<{ id: number; attribute_combinations?: Array<{ value_name: string | null }> }>;
};

// Publicaciones activas de ML (una fila por variación) + las que tienen costo cargado aunque estén pausadas,
// con lo vendido en los últimos 30 días según la pestaña rentabilidad_meli.
export async function getPublicaciones(): Promise<Publicacion[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const r = await mlFetch<{ results: string[]; paging: { total: number } }>(
      `/users/${ML_USER_ID()}/items/search?status=active&limit=100&offset=${offset}`,
    );
    ids.push(...r.results);
    if (offset + 100 >= r.paging.total) break;
  }
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) lotes.push(ids.slice(i, i + 20));
  const items = (
    await Promise.all(
      lotes.map((l) =>
        mlFetch<Array<{ code: number; body: ItemML }>>(`/items?ids=${l.join(',')}&attributes=id,title,secure_thumbnail,thumbnail,variations`),
      ),
    )
  )
    .flat()
    .filter((r) => r.code === 200)
    .map((r) => r.body);

  const [costos, ventas] = await Promise.all([leerCostos(), ventas30()]);
  const costoDe = new Map(costos.map((c) => [clave(c.item, c.variante), c]));
  const out = new Map<string, Publicacion>();
  const foto = (it: ItemML) => (it.secure_thumbnail || it.thumbnail || '').replace(/^http:\/\//, 'https://') || null;
  for (const it of items) {
    const filas = it.variations?.length
      ? it.variations.map((v) => ({ variant_id: String(v.id), variante: (v.attribute_combinations ?? []).map((a) => a.value_name).filter(Boolean).join(' / ') || null }))
      : [{ variant_id: null, variante: null }];
    for (const f of filas) {
      const k = clave(it.id, f.variant_id);
      // Una variación sin costo propio usa el de la publicación.
      const c = costoDe.get(k) ?? (f.variant_id ? costoDe.get(it.id) : undefined);
      const v = ventas.get(k) ?? { u: 0, sin: 0 };
      out.set(k, { item_id: it.id, variant_id: f.variant_id, titulo: it.title, variante: f.variante, foto: foto(it), costo: c?.costo || null, activa: true, vendidas30: v.u, sinCosto30: v.sin });
    }
  }
  for (const c of costos) {
    const k = clave(c.item, c.variante);
    if (out.has(k) || !c.item) continue;
    const v = ventas.get(k) ?? { u: 0, sin: 0 };
    out.set(k, { item_id: c.item, variant_id: c.variante && c.variante !== c.item ? c.variante : null, titulo: c.nombre || c.item, variante: null, foto: null, costo: c.costo || null, activa: false, vendidas30: v.u, sinCosto30: v.sin });
  }
  return [...out.values()];
}

async function ventas30() {
  const res = await sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'rentabilidad_meli'!A1:Z`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const [enc, ...filas] = res.data.values ?? [];
  const col = Object.fromEntries((enc ?? []).map((k, i) => [String(k), i]));
  const d = new Date(Date.now() - 3 * 3600e3);
  d.setUTCDate(d.getUTCDate() - 29);
  const desde = d.toISOString().slice(0, 10);
  const map = new Map<string, { u: number; sin: number }>();
  for (const r of filas) {
    if (String(r[col.fecha]) < desde || Number(r[col.anulada])) continue;
    const k = clave(String(r[col.item_id]), String(r[col.variante] ?? '') || null);
    const v = map.get(k) ?? { u: 0, sin: 0 };
    v.u += Number(r[col.unidades]) || 0;
    v.sin += Number(r[col.sin_costo]) || 0;
    map.set(k, v);
  }
  return map;
}

const letra = (i: number) => String.fromCharCode(65 + i);

// Guarda el costo de una publicación / variación. `desde`:
//  - 'siempre': vale para todas las ventas (lo normal para una publicación nueva que no tenía costo).
//  - una fecha: el costo anterior queda en costos_meli_historial hasta el día antes, y las ventas desde esa fecha
//    pasan al costo nuevo.
// Además recalcula en el momento el costo y el neto de esas ventas en rentabilidad_meli, sin esperar al script.
export async function setCostoPublicacion(p: { item_id: string; variant_id: string | null; costo: number; desde: string; nombre: string }) {
  const s = sheets();
  const costos = await leerCostos();
  const k = clave(p.item_id, p.variant_id);
  const actual = costos.find((c) => clave(c.item, c.variante) === k);

  // Períodos viejos de esta publicación: las ventas que caen en uno conservan ese costo.
  const hist = await s.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'costos_meli_historial'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  const periodos = (hist?.data.values ?? [])
    .filter((r) => clave(String(r[0]), String(r[1] ?? '')) === k)
    .map((r) => ({ desde: String(r[2] ?? ''), hasta: String(r[3]), costo: Number(r[5]) || 0 }));
  if (actual && actual.costo > 0 && actual.costo !== p.costo && p.desde !== 'siempre') {
    const desdePrev = periodos.reduce((m, r) => (r.hasta > m ? r.hasta : m), '');
    const viejo = { desde: desdePrev, hasta: p.desde, costo: actual.costo };
    periodos.push(viejo);
    await s.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'costos_meli_historial'!A:F`,
      valueInputOption: 'RAW',
      requestBody: { values: [[p.item_id, p.variant_id ?? p.item_id, viejo.desde, viejo.hasta, actual.tipo || 'LOCAL$', viejo.costo]] },
    });
  }
  const costoDelDia = (fecha: string) => periodos.find((v) => (!v.desde || v.desde <= fecha) && fecha < v.hasta)?.costo ?? p.costo;

  const fila = [p.item_id, p.variant_id ?? p.item_id, 'LOCAL$', p.costo, p.nombre];
  if (actual) {
    await s.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'costos_meli'!A${actual.fila}:E${actual.fila}`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
  } else {
    await s.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: `'costos_meli'!A:E`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
  }

  // Ventas que toma este costo: las de la variación, o si es el costo de la publicación, también las de sus
  // variaciones sin costo propio.
  const conCostoPropio = new Set(costos.filter((c) => c.item === p.item_id && c.variante && c.variante !== c.item).map((c) => c.variante));
  const res = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'rentabilidad_meli'!A1:Z`, valueRenderOption: 'UNFORMATTED_VALUE' });
  const [enc, ...filas] = res.data.values ?? [];
  const col = Object.fromEntries((enc ?? []).map((x, i) => [String(x), i]));
  const datos: { range: string; values: number[][] }[] = [];
  filas.forEach((r, i) => {
    if (String(r[col.item_id]) !== p.item_id) return;
    const variante = String(r[col.variante] ?? '');
    const corresponde = p.variant_id ? variante === p.variant_id : !variante || !conCostoPropio.has(variante);
    if (!corresponde || (p.desde !== 'siempre' && String(r[col.fecha]) < p.desde)) return;
    const costoViejo = Number(r[col.costo]) || 0;
    // Costo 0 sin unidades faltantes = el producto volvió al stock: no tiene costo.
    if (!costoViejo && !Number(r[col.sin_costo])) return;
    const costo = (Number(r[col.unidades]) || 0) * costoDelDia(String(r[col.fecha]));
    const v = (c: string) => Number(r[col[c]]) || 0;
    const neto = v('venta') - v('comision') - v('envio_ml') - v('envio_flex') - v('impuestos') - costo;
    const n = i + 2;
    datos.push({ range: `'rentabilidad_meli'!${letra(col.costo)}${n}:${letra(col.sin_costo)}${n}`, values: [[costo, Math.round(neto * 100) / 100, 0]] });
  });
  if (datos.length) {
    await s.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: datos } });
  }
  return { ventasRecalculadas: datos.length };
}
