// Costo de producto de la tienda de Empretienda cargado a mano (pestaña costos_tienda de la planilla MATEANDO MAYORISTA
// 2026): producto | costo sin IVA | actualizado. Gana a las reglas de scripts/cmv (lo leen tienda-rentabilidad.mjs y el
// CMV de /canales en empretienda-metricas.mjs). Sirve para los productos nuevos que todavía no tienen regla.
import { google } from 'googleapis';
import { getAuth } from './sheets';
import { getRentabilidadTienda } from './tienda';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'costos_tienda';
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
export const normalizar = (p: string) => p.toUpperCase().replace(/\s+/g, ' ').trim();

export type CostoProducto = { producto: string; costo: number; actualizado: string };
export type SinCosto = { producto: string; ventas: number; unidades: number; ultima: string; foto: string | null };

export async function getCostosTienda(): Promise<CostoProducto[]> {
  const r = await sheets()
    .spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:C`, valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  return (r?.data.values ?? [])
    .filter((f) => String(f[0] ?? '').trim())
    .map((f) => ({ producto: String(f[0]).trim(), costo: Number(f[1]) || 0, actualizado: String(f[2] ?? '') }));
}

// Productos vendidos en los últimos ~60 días (lo que guarda rentabilidad_tienda) que quedaron sin costo, sin los que ya
// tienen costo a mano.
export async function getSinCostoTienda(manuales: CostoProducto[]): Promise<SinCosto[]> {
  const { ventas, fotos } = await getRentabilidadTienda();
  const ya = new Set(manuales.map((m) => normalizar(m.producto)));
  const out = new Map<string, SinCosto>();
  for (const v of ventas) {
    for (const nombre of v.sin_costo_productos) {
      if (ya.has(normalizar(nombre))) continue;
      const p = v.productos.find((x) => x.n === nombre);
      const x = out.get(nombre) ?? { producto: nombre, ventas: 0, unidades: 0, ultima: '', foto: (p && fotos.get(String(p.id))?.foto) || null };
      x.ventas += 1;
      x.unidades += p?.q ?? 0;
      if (v.fecha > x.ultima) x.ultima = v.fecha;
      out.set(nombre, x);
    }
  }
  return [...out.values()].sort((a, b) => b.unidades - a.unidades || b.ultima.localeCompare(a.ultima));
}

// costo null = borrar el costo a mano (vuelve a las reglas).
export async function setCostoTienda(producto: string, costo: number | null) {
  const s = sheets();
  const lista = (await getCostosTienda()).filter((c) => normalizar(c.producto) !== normalizar(producto));
  if (costo != null) lista.push({ producto: producto.trim(), costo, actualizado: new Date().toISOString() });
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const hoja = meta.data.sheets?.find((h) => h.properties?.title === TAB);
  if (!hoja) await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  await s.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:C` });
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [['producto', 'costo', 'actualizado'], ...lista.map((c) => [c.producto, c.costo, c.actualizado])] },
  });
  return lista;
}
