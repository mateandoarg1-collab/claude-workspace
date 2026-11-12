// Costo de producto de la tienda de Empretienda cargado a mano (pestaña costos_tienda de la planilla MATEANDO MAYORISTA
// 2026): producto | costo sin IVA | actualizado | desde. Un producto puede tener varias filas: cada costo vale desde su
// fecha (YYYY-MM-DD) hasta el siguiente; sin fecha = desde siempre (corrige todas las ventas). Gana a las reglas de scripts/cmv (lo leen tienda-rentabilidad.mjs y el
// CMV de /canales en empretienda-metricas.mjs). Sirve para los productos nuevos que todavía no tienen regla.
import { google } from 'googleapis';
import { getAuth } from './sheets';
import { getRentabilidadTienda } from './tienda';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'costos_tienda';
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
export const normalizar = (p: string) => p.toUpperCase().replace(/\s+/g, ' ').trim();

export type CostoProducto = { producto: string; costo: number; actualizado: string; desde: string };
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
// Costo a mano vigente hoy de cada producto (la última fila con desde ≤ hoy).
export function vigentes(lista: CostoProducto[], dia = hoyAR()) {
  const m = new Map<string, number>();
  for (const c of [...lista].sort((a, b) => a.desde.localeCompare(b.desde))) if (c.desde <= dia) m.set(normalizar(c.producto), c.costo);
  return m;
}
// Un producto del catálogo (o vendido) con su costo por regla (pestaña tienda_costos_producto, la llena
// scripts/tienda-rentabilidad.mjs), el cargado a mano y lo vendido en ~60 días.
export type ProductoTienda = {
  producto: string; foto: string | null; activo: boolean; reglaMin: number | null; reglaMax: number | null;
  manual: number | null; historial: { desde: string; costo: number }[]; unidades: number; ventas: number; ultima: string;
  faltaCosto: boolean; // vendido en 60 días sin costo por regla (o alguna venta quedó sin costo)
  sinCosto: boolean; // faltaCosto y sin costo a mano
};

export async function getCostosTienda(): Promise<CostoProducto[]> {
  const r = await sheets()
    .spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:D`, valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  return (r?.data.values ?? [])
    .filter((f) => String(f[0] ?? '').trim())
    .map((f) => ({ producto: String(f[0]).trim(), costo: Number(f[1]) || 0, actualizado: String(f[2] ?? ''),
      desde: /^\d{4}-\d{2}-\d{2}/.test(String(f[3] ?? '')) ? String(f[3]).slice(0, 10) : '' }));
}

// Catálogo con costo por regla + costo a mano + ventas de los últimos 60 días (rentabilidad_tienda guarda más).
export async function getProductosTienda(manuales: CostoProducto[]): Promise<ProductoTienda[]> {
  const [{ ventas, fotos }, reglas] = await Promise.all([
    getRentabilidadTienda(),
    sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'tienda_costos_producto'!A2:G", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null),
  ]);
  const manual = vigentes(manuales);
  const historial = new Map<string, { desde: string; costo: number }[]>();
  for (const m of [...manuales].sort((a, b) => a.desde.localeCompare(b.desde))) {
    const k = normalizar(m.producto);
    historial.set(k, [...(historial.get(k) ?? []), { desde: m.desde, costo: m.costo }]);
  }
  const out = new Map<string, ProductoTienda>();
  const nuevo = (producto: string): ProductoTienda => ({
    producto, foto: null, activo: true, reglaMin: null, reglaMax: null, manual: manual.get(normalizar(producto)) ?? null, historial: historial.get(normalizar(producto)) ?? [],
    unidades: 0, ventas: 0, ultima: '', faltaCosto: false, sinCosto: false,
  });
  const desde = new Date(Date.now() - 3 * 3600e3 - 59 * 864e5).toISOString().slice(0, 10);
  for (const [, producto, desactivado, foto, min, max] of reglas?.data.values ?? []) {
    const p = nuevo(String(producto ?? '').trim());
    if (!p.producto) continue;
    Object.assign(p, { foto: String(foto ?? '') || null, activo: !Number(desactivado), reglaMin: min === '' ? null : Number(min), reglaMax: max === '' ? null : Number(max) });
    out.set(normalizar(p.producto), p);
  }
  for (const v of ventas) {
    if (v.fecha < desde) continue;
    const faltan = new Set(v.sin_costo_productos.map(normalizar));
    for (const x of v.productos) {
      const k = normalizar(x.n ?? '');
      if (!k) continue;
      const p = out.get(k) ?? nuevo(x.n);
      p.foto ??= fotos.get(String(x.id))?.foto ?? null;
      p.unidades += x.q || 0;
      p.ventas += 1;
      if (v.fecha > p.ultima) p.ultima = v.fecha;
      if (faltan.has(k)) p.faltaCosto = true;
      out.set(k, p);
    }
  }
  for (const p of out.values()) {
    if (p.unidades > 0 && p.reglaMin == null) p.faltaCosto = true;
    p.sinCosto = p.faltaCosto && p.manual == null;
  }
  return [...out.values()].sort((a, b) => b.unidades - a.unidades || a.producto.localeCompare(b.producto));
}

// costo null = borrar el costo a mano (vuelve a las reglas). Con desde (YYYY-MM-DD): el costo cambió ese día, las ventas
// anteriores siguen con el costo de antes. Sin desde: corrige el costo de todas las ventas (borra los cambios anteriores).
export async function setCostoTienda(producto: string, costo: number | null, desde = '') {
  const s = sheets();
  const k = normalizar(producto);
  // con fecha: se suma a los costos anteriores (reemplaza solo uno del mismo día); sin fecha: queda solo este
  const lista = (await getCostosTienda()).filter((c) => normalizar(c.producto) !== k || (costo != null && desde !== '' && c.desde !== desde));
  if (costo != null) lista.push({ producto: producto.trim(), costo, actualizado: new Date().toISOString(), desde });
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const hoja = meta.data.sheets?.find((h) => h.properties?.title === TAB);
  if (!hoja) await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  await s.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:D` });
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['producto', 'costo', 'actualizado', 'desde'], ...lista.map((c) => [c.producto, c.costo, c.actualizado, c.desde])] },
  });
  return lista;
}
