import { google } from 'googleapis';
import { meta, RECARGO } from './anuncios';
import { desdeAR } from './periodo';
import { getAuth, getEmpretiendaDiario } from './sheets';

// Ajuste diario de presupuesto por ROAS (pedido de Juampi, 6-nov-2026), para la pauta de la Tienda Online.
// ROAS de AYER = ventas Tienda Online de Empretienda (total − Acordar, igual que /canales) ÷ gasto Meta de
// META_AD_ACCOUNTS (MATEANDO2 + MATEANDO 3 MP, con RECARGO). Si ROAS ≥ subirSi → +paso% a todas las campañas
// activas; si ROAS < bajarSi → −paso%; en el medio no toca nada. Sin topes (lo eligió Juampi).
// Como el ROAS es de toda la tienda, todas las campañas activas se mueven igual. CBO: presupuesto de la campaña;
// ABO: presupuesto de cada conjunto activo. Los presupuestos totales (lifetime) no se tocan.
// Config: etiqueta de la cuenta MATEANDO2 "PANEL AJUSTE ROAS 10/8/10" (subirSi/bajarSi/paso). Sin etiqueta = apagado.
// Historial: pestaña "ajuste_presupuesto" de la planilla del panel (una corrida por día; si ya corrió, no repite).
// Lo dispara el servidor DonWeb a las 10:00 (POST /api/anuncios/presupuesto/control).

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const PESTANA = 'ajuste_presupuesto';
const PREFIJO = 'PANEL AJUSTE ROAS ';
export const CUENTA_CONFIG = 'act_1439554678210755'; // MATEANDO2

export type Config = { subirSi: number; bajarSi: number; paso: number };
export type Cambio = { cuenta: string; id: string; nombre: string; tipo: 'campaña' | 'conjunto'; antes: number; despues: number; error?: string };
export type Resultado = {
  dia: string; ventas: number | null; gasto: number; roas: number | null; accion: 'subir' | 'bajar' | 'mantener' | 'sin datos';
  cambios: Cambio[]; yaCorrio?: boolean; config: Config | null;
};

const token = () => process.env.META_ACCESS_TOKEN!;
const cuentas = () => (process.env.META_AD_ACCOUNTS ?? '').split(',').map((c) => c.trim()).filter(Boolean);

export async function leerConfig(): Promise<Config | null> {
  const j = await meta(`${CUENTA_CONFIG}/adlabels?fields=name&limit=500`, token());
  const l = (j.data as Array<{ name: string }>).find((x) => x.name.startsWith(PREFIJO));
  if (!l) return null;
  const [subirSi, bajarSi, paso] = l.name.slice(PREFIJO.length).split('/').map(Number);
  return subirSi && bajarSi && paso ? { subirSi, bajarSi, paso } : null;
}

export async function guardarConfig(c: Config | null) {
  const j = await meta(`${CUENTA_CONFIG}/adlabels?fields=name&limit=500`, token());
  for (const l of (j.data as Array<{ id: string; name: string }>).filter((x) => x.name.startsWith(PREFIJO))) {
    await meta(l.id, token(), { method: 'DELETE' });
  }
  if (c) await meta(`${CUENTA_CONFIG}/adlabels`, token(), { body: { name: `${PREFIJO}${c.subirSi}/${c.bajarSi}/${c.paso}` } });
}

// ROAS de un día (AAAA-MM-DD, hora Argentina).
export async function roasDelDia(dia: string) {
  const fila = (await getEmpretiendaDiario()).find((r) => r.dia === dia);
  const ventas = fila ? fila.totalMonto - fila.acordarMonto : null;
  const range = encodeURIComponent(JSON.stringify({ since: dia, until: dia }));
  let gasto = 0;
  for (const c of cuentas()) {
    const j = await meta(`${c}/insights?fields=spend&time_range=${range}`, token());
    gasto += Number(j.data?.[0]?.spend ?? 0) * (RECARGO[c] ?? 1);
  }
  return { ventas, gasto, roas: ventas !== null && gasto > 0 ? ventas / gasto : null };
}

type Presupuesto = { cuenta: string; id: string; nombre: string; tipo: 'campaña' | 'conjunto'; diario: number };

// Presupuestos diarios activos: el de la campaña (CBO) o el de cada conjunto activo (ABO).
export async function presupuestosActivos(): Promise<Presupuesto[]> {
  const out: Presupuesto[] = [];
  const activo = encodeURIComponent(JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE'] }]));
  for (const c of cuentas()) {
    const camps = await meta(`${c}/campaigns?limit=200&filtering=${activo}&fields=name,daily_budget,adsets.limit(100){name,daily_budget,effective_status}`, token());
    type Camp = { id: string; name: string; daily_budget?: string; adsets?: { data: Array<{ id: string; name: string; daily_budget?: string; effective_status: string }> } };
    for (const k of camps.data as Camp[]) {
      if (Number(k.daily_budget) > 0) out.push({ cuenta: c, id: k.id, nombre: k.name, tipo: 'campaña', diario: Number(k.daily_budget) });
      else for (const a of k.adsets?.data ?? []) {
        if (a.effective_status === 'ACTIVE' && Number(a.daily_budget) > 0) {
          out.push({ cuenta: c, id: a.id, nombre: `${k.name} › ${a.name}`, tipo: 'conjunto', diario: Number(a.daily_budget) });
        }
      }
    }
  }
  return out;
}

async function sheets() {
  const s = google.sheets({ version: 'v4', auth: getAuth() });
  const info = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  if (!info.data.sheets?.some((x) => x.properties?.title === PESTANA)) {
    await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: PESTANA } } }] } });
    await s.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A1`, valueInputOption: 'RAW',
      requestBody: { values: [['dia_medido', 'corrido', 'roas', 'ventas', 'gasto', 'accion', 'cuenta', 'id', 'nombre', 'antes', 'despues', 'error']] },
    });
  }
  return s;
}

export async function historial(limite = 60) {
  const s = await sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A2:L` });
  return (r.data.values ?? []).slice(-limite).reverse().map((v) => ({
    dia: String(v[0]), corrido: String(v[1]), roas: Number(v[2]) || null, ventas: Number(v[3]) || 0, gasto: Number(v[4]) || 0,
    accion: String(v[5]), nombre: String(v[8] ?? ''), antes: Number(v[9]) || 0, despues: Number(v[10]) || 0, error: String(v[11] ?? ''),
  }));
}

// Corre el ajuste sobre el día de ayer. dry = solo calcula. forzar = corre aunque ya haya corrido ese día.
export async function ajustar(dry = false, forzar = false): Promise<Resultado> {
  const dia = desdeAR('ayer');
  const config = await leerConfig();
  const { ventas, gasto, roas } = await roasDelDia(dia);
  const base = { dia, ventas, gasto, roas, config, cambios: [] as Cambio[] };
  if (!config) return { ...base, accion: 'mantener' };
  if (roas === null) return { ...base, accion: 'sin datos' };
  const accion = roas >= config.subirSi ? 'subir' : roas < config.bajarSi ? 'bajar' : 'mantener';

  const s = dry ? null : await sheets();
  if (s && !forzar) {
    const r = await s.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A2:A` });
    if ((r.data.values ?? []).some((v) => v[0] === dia)) return { ...base, accion, yaCorrio: true };
  }

  const factor = accion === 'subir' ? 1 + config.paso / 100 : accion === 'bajar' ? 1 - config.paso / 100 : 1;
  const cambios: Cambio[] = [];
  if (factor !== 1) {
    for (const p of await presupuestosActivos()) {
      // Meta guarda el presupuesto en centavos: se redondea a pesos enteros.
      const despues = Math.round((p.diario * factor) / 100) * 100;
      const c: Cambio = { cuenta: p.cuenta, id: p.id, nombre: p.nombre, tipo: p.tipo, antes: p.diario / 100, despues: despues / 100 };
      if (!dry) {
        try { await meta(p.id, token(), { body: { daily_budget: String(despues) } }); }
        catch (e) { c.error = e instanceof Error ? e.message : String(e); }
      }
      cambios.push(c);
    }
  }

  if (s) {
    const ahora = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const fila = (c?: Cambio) => [dia, ahora, roas.toFixed(2), Math.round(ventas ?? 0), Math.round(gasto), accion, c?.cuenta ?? '', c?.id ?? '', c?.nombre ?? '', c?.antes ?? '', c?.despues ?? '', c?.error ?? ''];
    await s.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID, range: `'${PESTANA}'!A1`, valueInputOption: 'RAW',
      requestBody: { values: cambios.length ? cambios.map(fila) : [fila()] },
    });
  }
  return { ...base, accion, cambios };
}
