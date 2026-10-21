// Posventa: reclamos de la planilla "POSTVENTA - MAU" (pestaña Reclamos, la carga el equipo de posventa) y unidades
// vendidas por SKU (pestaña unidades_sku de la planilla mayorista, la llena scripts/empretienda-metricas.mjs) para el
// % de falla. El producto del reclamo se une al SKU por el nombre de la planilla "Costos JP - meli".
import { google } from 'googleapis';
import { getAuth } from './sheets';

const POSVENTA_ID = '1mnylnpqNhLgBbOj2s1Paa5jl12j-jVx6vE5h9sqlY5w';
const MAYORISTA_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const COSTOS_JP = '1VP12eqQsJpZdOA6crIUMZccqpPobVZzxc8jev2iUkF8';

export type CanalPv = 'online' | 'ml' | 'local' | 'shopify' | 'mayorista' | 'otro';

export type Reclamo = {
  fecha: string | null; // YYYY-MM-DD, null si está mal cargada
  canal: CanalPv;
  orden: string;
  producto: string;
  sku: string | null;
  motivo: string;
  resolucion: string;
  estado: string;
  costo: number;
  responsable: string;
  fechaResolucion: string | null;
  dias: number | null;
};

const norm = (t: unknown) => String(t ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
const num = (v: unknown) => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$.\s]/g, '').replace(',', '.')) || 0);

function fecha(v: unknown): string | null {
  const m = String(v ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m || Number(m[3]) < 2025) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function canal(v: unknown): CanalPv {
  const c = norm(v);
  if (c === 'WEB' || c === 'WHATSAPP') return 'online';
  if (c === 'MERCADO LIBRE') return 'ml';
  if (c === 'LOCAL') return 'local';
  if (c === 'SHOPIFY') return 'shopify';
  if (c === 'MAYORISTA') return 'mayorista';
  return 'otro';
}

// Nombres cargados a mano que no están en la planilla de costos.
const ALIAS: [RegExp, string][] = [
  [/^YERBERA GAMUZA$/, 'YERB-GAM-8008'],
  [/ROSA.*(4|PUNTAS)|(4|PUNTAS).*ROSA/, 'MATE-MAD-2015'], // ranchero 4.0 / 4 puntas rosa
  [/^(MATE )?RAN\w* ROSA+$/, 'MATE-MAD-2020'], // "ranchero rosa" (y errores de tipeo) = el nuevo Rose Quartz
  [/^RANCHERO BLANCO$/, 'MATE-MAD-2003'],
  [/^COQUITO$/, 'DISC-COQUITO'],
];

async function nombreASku(sheets: ReturnType<typeof google.sheets>) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: COSTOS_JP, fields: 'sheets.properties.title' });
  const hojas = (meta.data.sheets ?? []).map((h) => h.properties?.title ?? '').filter((h) => h && !['BASE scalify', 'Hoja 22'].includes(h));
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId: COSTOS_JP, ranges: hojas.map((h) => `'${h}'!A2:F400`) });
  const map = new Map<string, { sku: string; nombre: string }>();
  for (const vr of res.data.valueRanges ?? []) {
    for (const r of vr.values ?? []) if (r[0] && r[5]) map.set(norm(r[0]), { sku: String(r[5]).trim(), nombre: String(r[0]).trim() });
  }
  return map;
}

export async function getReclamos(): Promise<{ reclamos: Reclamo[]; nombres: Record<string, string> }> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const [res, skus] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: POSVENTA_ID,
      range: "'Reclamos'!A4:P",
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    }),
    nombreASku(sheets),
  ]);
  // Nombres de SKUs que no están (o no tienen SKU) en la planilla de costos.
  const nombres: Record<string, string> = { 'MATE-MAD-2020': 'MATE RANCHERO ROSE QUARTZ (NUEVO)', 'DISC-COQUITO': 'MATE COQUITO (discontinuado)' };
  for (const v of skus.values()) nombres[v.sku] ??= v.nombre;
  const reclamos: Reclamo[] = [];
  for (const r of res.data.values ?? []) {
    if (!r[0] && !r[3]) continue;
    const prod = norm(r[3]);
    const sku = skus.get(prod)?.sku ?? ALIAS.find(([rx]) => rx.test(prod))?.[1] ?? null;
    reclamos.push({
      fecha: fecha(r[0]),
      canal: canal(r[1]),
      orden: String(r[2] ?? ''),
      producto: String(r[3] ?? '').trim(),
      sku,
      motivo: String(r[5] ?? '').trim() || 'Sin motivo',
      resolucion: String(r[6] ?? '').trim(),
      estado: String(r[7] ?? '').trim(),
      costo: num(r[11]),
      responsable: String(r[12] ?? '').trim().replace(/^fabricacion$/i, 'Fabricacion').replace(/^local$/i, 'Local') || 'Sin asignar',
      fechaResolucion: fecha(r[14]),
      dias: typeof r[15] === 'number' ? r[15] : null,
    });
  }
  return { reclamos, nombres };
}

// Unidades vendidas por mes y SKU en Empretienda (Tienda Online + Local), con los kits desarmados en sus productos.
export async function getUnidadesSku() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values
    .get({ spreadsheetId: MAYORISTA_ID, range: "'unidades_sku'!A2:D" })
    .catch(() => null);
  return (res?.data.values ?? []).map((r) => ({ mes: String(r[0]), sku: String(r[1]), online: Number(r[2]) || 0, local: Number(r[3]) || 0 }));
}

// Costo de posventa por canal entre dos días AR (inclusive), para restarlo del margen en /canales.
export async function getCostoPosventa(desde: string, hasta: string) {
  const { reclamos } = await getReclamos();
  const out: Record<CanalPv, number> = { online: 0, ml: 0, local: 0, shopify: 0, mayorista: 0, otro: 0 };
  for (const r of reclamos) if (r.fecha && r.fecha >= desde && r.fecha <= hasta) out[r.canal] += r.costo;
  return out;
}
