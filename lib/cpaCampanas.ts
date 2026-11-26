import { google } from 'googleapis';
import { getAuth } from './sheets';
import { meta, RECARGO, tokenPara } from './anuncios';
import { ETIQUETA_APAGADO } from './cpaMax';

// CPA máximo POR CAMPAÑA (pedido de Juampi, 26-nov-2026), en /anuncios/campanas.
// Regla: un anuncio activo de una campaña con CPA máx se pausa cuando ya lleva 48 h gastando (su primer día con gasto
// fue hace 2 días o más) y en los últimos 7 días (con hoy) su CPA supera el máximo, o gastó más que el máximo sin ventas.
// Los anuncios de estas campañas NO los toca el CPA máx por cuenta (lib/cpaMax.ts).
// El control lo dispara el servidor de DonWeb cada 30 min junto con el de cuenta (POST /api/anuncios/cpa-max/control).
// Se guarda en la pestaña cpa_campanas de la planilla MATEANDO MAYORISTA 2026: cuenta | campaña id | campaña | cpa máx | actualizado.

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'cpa_campanas';
const COMPRA = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'];
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

export type CpaCampana = { cuenta: string; id: string; nombre: string; cpaMax: number };

async function asegurarPestana() {
  const s = sheets();
  const info = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  if (info.data.sheets?.some((x) => x.properties?.title === TAB)) return;
  await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  await s.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:E1`, valueInputOption: 'RAW',
    requestBody: { values: [['cuenta', 'campana_id', 'campana', 'cpa_max', 'actualizado']] },
  });
}

export async function leerCpaCampanas(): Promise<CpaCampana[]> {
  try {
    const r = await sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:D` });
    return (r.data.values ?? [])
      .map((f) => ({ cuenta: String(f[0] ?? ''), id: String(f[1] ?? ''), nombre: String(f[2] ?? ''), cpaMax: Number(f[3]) || 0 }))
      .filter((c) => c.cuenta && c.id && c.cpaMax > 0);
  } catch (e) {
    if (String(e).includes('Unable to parse range')) return []; // la pestaña todavía no existe
    throw e;
  }
}

// cpaMax null/0 = sacar el control de esa campaña.
export async function guardarCpaCampana(cuenta: string, id: string, nombre: string, cpaMax: number | null) {
  await asegurarPestana();
  const s = sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:E` });
  const filas = (r.data.values ?? []).filter((f) => String(f[1] ?? '') !== id);
  if (cpaMax && cpaMax > 0) filas.push([cuenta, id, nombre, Math.round(cpaMax), new Date().toISOString()]);
  await s.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2:E` });
  if (filas.length) {
    await s.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A2`, valueInputOption: 'RAW', requestBody: { values: filas } });
  }
}

const diaAR = (offset = 0) => new Date(Date.now() - 3 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10);
const compras = (actions?: Array<{ action_type: string; value: string }>) => {
  for (const t of COMPRA) {
    const a = actions?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

async function todas<T>(url: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let u: string | null = url;
  for (let i = 0; u && i < 20; i++) {
    const j = await meta(u, token);
    out.push(...(j.data ?? []));
    u = j.paging?.next ?? null;
  }
  return out;
}

export type DecisionAnuncio = {
  id: string; nombre: string; campanaId: string; gasto: number; compras: number; cpa: number | null;
  primerDia: string; espera: boolean; motivo: string;
};

// Anuncios activos de las campañas dadas, con gasto/ventas de los últimos 7 días (con hoy) y su primer día con gasto.
async function anunciosDe(cuenta: string, campanas: string[]): Promise<DecisionAnuncio[]> {
  if (!campanas.length) return [];
  const token = tokenPara(cuenta)!;
  const recargo = RECARGO[cuenta] ?? 1;
  const filtro = encodeURIComponent(JSON.stringify([
    { field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] },
    { field: 'campaign.id', operator: 'IN', value: campanas },
  ]));
  const rango = encodeURIComponent(JSON.stringify({ since: diaAR(6), until: diaAR(0) }));
  type Fila = { ad_id: string; ad_name: string; campaign_id: string; date_start: string; spend: string; actions?: Array<{ action_type: string; value: string }> };
  const filas = await todas<Fila>(
    `${cuenta}/insights?level=ad&time_range=${rango}&time_increment=1&limit=500&filtering=${filtro}&fields=ad_id,ad_name,campaign_id,spend,actions`,
    token,
  );
  const m = new Map<string, DecisionAnuncio>();
  for (const f of filas) {
    const g = Number(f.spend ?? 0) * recargo;
    const a = m.get(f.ad_id) ?? { id: f.ad_id, nombre: f.ad_name, campanaId: f.campaign_id, gasto: 0, compras: 0, cpa: null, primerDia: '', espera: false, motivo: '' };
    a.gasto += g;
    a.compras += compras(f.actions);
    if (g > 0 && (!a.primerDia || f.date_start < a.primerDia)) a.primerDia = f.date_start;
    m.set(f.ad_id, a);
  }
  return [...m.values()].map((a) => ({ ...a, cpa: a.compras > 0 ? a.gasto / a.compras : null }));
}

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

function decidir(a: DecisionAnuncio, cpaMax: number): DecisionAnuncio {
  // 48 h de gasto: el primer día con gasto tiene que ser de anteayer o antes.
  const espera = !a.primerDia || a.primerDia > diaAR(2);
  const motivo =
    a.cpa !== null && a.cpa > cpaMax ? `CPA ${$(a.cpa)} > máx ${$(cpaMax)}`
    : a.compras === 0 && a.gasto > cpaMax ? `Gastó ${$(a.gasto)} sin ventas`
    : '';
  return { ...a, espera, motivo };
}

// Revisa y (si no es dry) pausa los anuncios que no cumplen el CPA máx de su campaña.
export async function controlarCampanas(cuenta: string, dry = false, config?: CpaCampana[]) {
  const lista = (config ?? (await leerCpaCampanas())).filter((c) => c.cuenta === cuenta);
  if (!lista.length) return { campanas: 0, revisados: 0, apagados: [] as DecisionAnuncio[], enEspera: [] as DecisionAnuncio[] };
  const token = tokenPara(cuenta)!;
  const max = new Map(lista.map((c) => [c.id, c.cpaMax]));
  const anuncios = (await anunciosDe(cuenta, [...max.keys()])).map((a) => decidir(a, max.get(a.campanaId)!));
  const apagados = anuncios.filter((a) => a.motivo && !a.espera);
  if (!dry) for (const a of apagados) await meta(a.id, token, { body: { status: 'PAUSED', adlabels: [{ name: ETIQUETA_APAGADO }] } });
  return { campanas: lista.length, revisados: anuncios.length, apagados, enEspera: anuncios.filter((a) => a.motivo && a.espera) };
}

export type CampanaActiva = {
  id: string; nombre: string; presupuestoDiario: number | null; gasto: number; compras: number; cpa: number | null;
  cpaMax: number | null; seApagarian: DecisionAnuncio[]; enEspera: DecisionAnuncio[]; anunciosActivos: number;
};

// Campañas activas de la cuenta con gasto/ventas de 7 días, su CPA máx y la vista previa de lo que se apagaría.
export async function campanasActivas(cuenta: string): Promise<CampanaActiva[]> {
  const token = tokenPara(cuenta)!;
  const recargo = RECARGO[cuenta] ?? 1;
  const estado = encodeURIComponent(JSON.stringify(['ACTIVE']));
  type Camp = { id: string; name: string; daily_budget?: string };
  const [camps, config] = await Promise.all([
    todas<Camp>(`${cuenta}/campaigns?effective_status=${estado}&fields=name,daily_budget&limit=200`, token),
    leerCpaCampanas(),
  ]);
  if (!camps.length) return [];
  const ids = camps.map((c) => c.id);
  const filtro = encodeURIComponent(JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }]));
  const rango = encodeURIComponent(JSON.stringify({ since: diaAR(6), until: diaAR(0) }));
  type Ins = { campaign_id: string; spend: string; actions?: Array<{ action_type: string; value: string }> };
  const ins = await todas<Ins>(`${cuenta}/insights?level=campaign&time_range=${rango}&limit=500&filtering=${filtro}&fields=campaign_id,spend,actions`, token);
  const porCamp = new Map(ins.map((i) => [i.campaign_id, i]));
  const max = new Map(config.filter((c) => c.cuenta === cuenta).map((c) => [c.id, c.cpaMax]));
  const anuncios = await anunciosDe(cuenta, ids);
  return camps.map((c) => {
    const i = porCamp.get(c.id);
    const gasto = Number(i?.spend ?? 0) * recargo;
    const v = compras(i?.actions);
    const cpaMax = max.get(c.id) ?? null;
    const suyos = anuncios.filter((a) => a.campanaId === c.id);
    const dec = cpaMax ? suyos.map((a) => decidir(a, cpaMax)) : [];
    return {
      id: c.id, nombre: c.name, presupuestoDiario: c.daily_budget ? Number(c.daily_budget) / 100 : null,
      gasto, compras: v, cpa: v > 0 ? gasto / v : null, cpaMax, anunciosActivos: suyos.length,
      seApagarian: dec.filter((a) => a.motivo && !a.espera), enEspera: dec.filter((a) => a.motivo && a.espera),
    };
  }).sort((a, b) => b.gasto - a.gasto);
}
