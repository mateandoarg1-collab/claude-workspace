import { google } from 'googleapis';
import { meta, RECARGO } from './anuncios';
import { desdeAR } from './periodo';
import { getAuth } from './sheets';

// Ajuste diario de presupuesto por campaña (pedido de Juampi, 6-nov-2026), cuentas de la Tienda Online
// (META_AD_ACCOUNTS: MATEANDO2 + MATEANDO 3 MP). Mira AYER cada campaña activa con lo que atribuye Meta
// (gasto con RECARGO, compras y valor de compra del píxel):
//   ROAS > subirRoas  o  CPA < subirCpa  → sube paso%
//   CPA > bajarCpa (o gastó más que bajarCpa sin ventas)  → baja paso%   (si ROAS > subirRoas, gana subir)
//   el resto no se toca. Sin topes.
// CBO: presupuesto y métricas de la campaña; ABO: de cada conjunto activo.
// Config: etiqueta de la cuenta MATEANDO2 "PANEL AJUSTE ROAS 10/14000/20000/10" (subirRoas/subirCpa/bajarCpa/paso).
// Sin etiqueta = apagado.
// Historial: pestaña "ajuste_presupuesto" de la planilla del panel (una corrida por día; si ya corrió, no repite).
// Lo dispara el servidor DonWeb a las 10:00 (POST /api/anuncios/presupuesto/control).

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const PESTANA = 'ajuste_presupuesto';
const PREFIJO = 'PANEL AJUSTE ROAS ';
export const CUENTA_CONFIG = 'act_1439554678210755'; // MATEANDO2
const COMPRA = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'];

export type Config = { subirRoas: number; subirCpa: number; bajarCpa: number; paso: number };
export type Accion = 'subir' | 'bajar' | 'mantener';
export type Item = {
  cuenta: string; id: string; nombre: string; tipo: 'campaña' | 'conjunto';
  gasto: number; compras: number; facturacion: number; roas: number | null; cpa: number | null;
  accion: Accion; motivo: string; antes: number; despues: number; error?: string;
};
export type Resultado = { dia: string; config: Config | null; items: Item[]; yaCorrio?: boolean };

const token = () => process.env.META_ACCESS_TOKEN!;
const cuentas = () => (process.env.META_AD_ACCOUNTS ?? '').split(',').map((c) => c.trim()).filter(Boolean);
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

async function etiquetas() {
  const j = await meta(`${CUENTA_CONFIG}/adlabels?fields=name&limit=500`, token());
  return (j.data ?? []) as Array<{ id: string; name: string }>;
}

export async function leerConfig(): Promise<Config | null> {
  const l = (await etiquetas()).find((x) => x.name.startsWith(PREFIJO));
  if (!l) return null;
  const [subirRoas, subirCpa, bajarCpa, paso] = l.name.slice(PREFIJO.length).split('/').map(Number);
  return subirRoas && subirCpa && bajarCpa && paso ? { subirRoas, subirCpa, bajarCpa, paso } : null;
}

export async function guardarConfig(c: Config | null) {
  for (const l of (await etiquetas()).filter((x) => x.name.startsWith(PREFIJO))) await meta(l.id, token(), { method: 'DELETE' });
  if (c) await meta(`${CUENTA_CONFIG}/adlabels`, token(), { body: { name: `${PREFIJO}${c.subirRoas}/${c.subirCpa}/${c.bajarCpa}/${c.paso}` } });
}

type Fila = { campaign_id?: string; adset_id?: string; spend?: string; actions?: Array<{ action_type: string; value: string }>; action_values?: Array<{ action_type: string; value: string }> };
const valorCompra = (l?: Array<{ action_type: string; value: string }>) => {
  for (const t of COMPRA) { const a = l?.find((x) => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
};

async function insights(cuenta: string, nivel: 'campaign' | 'adset', dia: string) {
  const range = encodeURIComponent(JSON.stringify({ since: dia, until: dia }));
  const out = new Map<string, { gasto: number; compras: number; facturacion: number }>();
  let url: string | null = `${cuenta}/insights?level=${nivel}&time_range=${range}&limit=500&fields=campaign_id,adset_id,spend,actions,action_values`;
  for (let i = 0; url && i < 10; i++) {
    const j = await meta(url, token());
    for (const f of (j.data ?? []) as Fila[]) {
      out.set((nivel === 'campaign' ? f.campaign_id : f.adset_id)!, {
        gasto: Number(f.spend ?? 0) * (RECARGO[cuenta] ?? 1), compras: valorCompra(f.actions), facturacion: valorCompra(f.action_values),
      });
    }
    url = j.paging?.next ?? null;
  }
  return out;
}

export function decidir(c: Config, gasto: number, compras: number, roas: number | null, cpa: number | null): { accion: Accion; motivo: string } {
  if (roas !== null && roas > c.subirRoas) return { accion: 'subir', motivo: `ROAS ${roas.toFixed(1)}x > ${c.subirRoas}` };
  if (cpa !== null && cpa < c.subirCpa) return { accion: 'subir', motivo: `CPA ${$(cpa)} < ${$(c.subirCpa)}` };
  if (cpa !== null && cpa > c.bajarCpa) return { accion: 'bajar', motivo: `CPA ${$(cpa)} > ${$(c.bajarCpa)}` };
  if (compras === 0 && gasto > c.bajarCpa) return { accion: 'bajar', motivo: `Gastó ${$(gasto)} sin ventas` };
  return { accion: 'mantener', motivo: cpa !== null ? `CPA ${$(cpa)}` : gasto ? `Gastó ${$(gasto)} sin ventas` : 'Sin gasto' };
}

// Campañas activas (CBO) o conjuntos activos (ABO) con su presupuesto diario y lo que rindieron el día dado.
export async function evaluar(dia: string, c: Config | null): Promise<Item[]> {
  const cfg = c ?? { subirRoas: 10, subirCpa: 14000, bajarCpa: 20000, paso: 10 };
  const factor = (a: Accion) => (a === 'subir' ? 1 + cfg.paso / 100 : a === 'bajar' ? 1 - cfg.paso / 100 : 1);
  const activo = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]));
  const items: Item[] = [];
  for (const cuenta of cuentas()) {
    const [porCamp, porConj, camps] = await Promise.all([
      insights(cuenta, 'campaign', dia), insights(cuenta, 'adset', dia),
      meta(`${cuenta}/campaigns?limit=200&filtering=${activo}&fields=name,daily_budget,adsets.limit(100){name,daily_budget,effective_status}`, token()),
    ]);
    type Camp = { id: string; name: string; daily_budget?: string; adsets?: { data: Array<{ id: string; name: string; daily_budget?: string; effective_status: string }> } };
    const objetos: Array<{ id: string; nombre: string; tipo: 'campaña' | 'conjunto'; diario: number; m?: { gasto: number; compras: number; facturacion: number } }> = [];
    for (const k of camps.data as Camp[]) {
      if (Number(k.daily_budget) > 0) objetos.push({ id: k.id, nombre: k.name, tipo: 'campaña', diario: Number(k.daily_budget), m: porCamp.get(k.id) });
      else for (const a of k.adsets?.data ?? []) {
        if (a.effective_status === 'ACTIVE' && Number(a.daily_budget) > 0) {
          objetos.push({ id: a.id, nombre: `${k.name} › ${a.name}`, tipo: 'conjunto', diario: Number(a.daily_budget), m: porConj.get(a.id) });
        }
      }
    }
    for (const o of objetos) {
      const gasto = o.m?.gasto ?? 0, compras = o.m?.compras ?? 0, facturacion = o.m?.facturacion ?? 0;
      const roas = gasto > 0 && facturacion > 0 ? facturacion / gasto : null;
      const cpa = compras > 0 ? gasto / compras : null;
      const { accion, motivo } = decidir(cfg, gasto, compras, roas, cpa);
      // Meta guarda el presupuesto en centavos: se redondea a pesos enteros.
      const despues = Math.round((o.diario * factor(accion)) / 100) * 100;
      items.push({ cuenta, id: o.id, nombre: o.nombre, tipo: o.tipo, gasto, compras, facturacion, roas, cpa, accion, motivo, antes: o.diario / 100, despues: despues / 100 });
    }
  }
  return items;
}

async function sheets() {
  const s = google.sheets({ version: 'v4', auth: getAuth() });
  const info = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  if (!info.data.sheets?.some((x) => x.properties?.title === PESTANA)) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: PESTANA } } }] } });
  }
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A1`, valueInputOption: 'RAW',
    requestBody: { values: [['dia_medido', 'corrido', 'roas', 'cpa', 'gasto', 'accion', 'cuenta', 'id', 'nombre', 'antes', 'despues', 'error', 'motivo']] },
  });
  return s;
}

export async function historial(limite = 80) {
  const s = await sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A2:M` });
  return (r.data.values ?? []).slice(-limite).reverse().map((v) => ({
    dia: String(v[0]), corrido: String(v[1]), roas: Number(v[2]) || null, cpa: Number(v[3]) || null, gasto: Number(v[4]) || 0,
    accion: String(v[5]), nombre: String(v[8] ?? ''), antes: Number(v[9]) || 0, despues: Number(v[10]) || 0, error: String(v[11] ?? ''), motivo: String(v[12] ?? ''),
  }));
}

// Corre el ajuste con lo de ayer. dry = solo calcula. forzar = corre aunque ya haya corrido ese día.
export async function ajustar(dry = false, forzar = false): Promise<Resultado> {
  const dia = desdeAR('ayer');
  const config = await leerConfig();
  const items = await evaluar(dia, config);
  if (!config || dry) return { dia, config, items };

  const s = await sheets();
  if (!forzar) {
    const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A2:A` });
    if ((r.data.values ?? []).some((v) => v[0] === dia)) return { dia, config, items, yaCorrio: true };
  }
  const cambian = items.filter((i) => i.accion !== 'mantener');
  for (const i of cambian) {
    try { await meta(i.id, token(), { body: { daily_budget: String(Math.round(i.despues * 100)) } }); }
    catch (e) { i.error = e instanceof Error ? e.message : String(e); }
  }
  const ahora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const fila = (i?: Item) => [dia, ahora, i?.roas?.toFixed(2) ?? '', i?.cpa ? Math.round(i.cpa) : '', i ? Math.round(i.gasto) : '', i?.accion ?? 'sin cambios',
    i?.cuenta ?? '', i?.id ?? '', i?.nombre ?? '', i?.antes ?? '', i?.despues ?? '', i?.error ?? '', i?.motivo ?? ''];
  await s.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A1`, valueInputOption: 'RAW',
    requestBody: { values: cambian.length ? cambian.map(fila) : [fila()] },
  });
  return { dia, config, items };
}
