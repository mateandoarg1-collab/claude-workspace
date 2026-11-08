import { google } from 'googleapis';
import { getAuth } from './sheets';
import { listarEnvios } from './envios';

// Escaneo de etiquetas de OCA al embalar (/despacho). Cada escaneo queda en la pestaña `despacho` de la planilla de
// Empretienda: fecha, número de envío OCA, número de orden y quién lo escaneó. /envios lo usa para el estado "Embalado".
// El código de barras de la etiqueta es "<número de envío>-<bulto>" (ej. 8292300000000198427-1).
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'despacho';

export type Escaneo = { fecha: string; envio: string; orden: string; quien: string };

const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

export async function getEscaneos(): Promise<Escaneo[]> {
  const r = await sheets().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:D` }).catch(() => null);
  return (r?.data.values ?? []).map((x) => ({ fecha: String(x[0] ?? ''), envio: String(x[1] ?? ''), orden: String(x[2] ?? ''), quien: String(x[3] ?? '') }));
}

async function asegurarPestaña() {
  const s = sheets();
  const meta = await s.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  if (meta.data.sheets?.some((x) => x.properties?.title === TAB)) return;
  await s.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  await s.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['fecha', 'envio_oca', 'orden', 'quien']] } });
}

export type Resultado =
  | { ok: true; envio: string; orden: string; repetido: false }
  | { ok: false; envio: string | null; orden: string | null; repetido: boolean; error: string };

export async function registrar(codigo: string, quien: string): Promise<Resultado> {
  const envio = codigo.match(/\d{19}/)?.[0] ?? null;
  if (!envio) return { ok: false, envio: null, orden: null, repetido: false, error: 'No es una etiqueta de OCA' };
  const [envios, previos] = await Promise.all([listarEnvios(20), getEscaneos()]);
  let orden: string | null = null;
  for (const [o, ns] of envios) if (ns.includes(envio)) orden = o;
  const ya = previos.find((e) => e.envio === envio);
  if (ya) return { ok: false, envio, orden: orden ?? ya.orden, repetido: true, error: `Ya escaneada (${ya.quien || 'sin nombre'})` };
  if (!orden) return { ok: false, envio, orden: null, repetido: false, error: 'OCA no tiene esta etiqueta en los últimos 20 días' };
  await asegurarPestaña();
  const fecha = new Date().toISOString();
  await sheets().spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:D`, valueInputOption: 'RAW', requestBody: { values: [[fecha, envio, orden, quien]] },
  });
  return { ok: true, envio, orden, repetido: false };
}
