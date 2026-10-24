// Histórico de ventas por mes y canal (pestaña historico_mensual de la planilla mayorista), para no recalcular meses
// cerrados en cada lectura. Filas: mes (YYYY-MM) | canal | monto | ventas | fuente | actualizado.
// - Tienda Online y Local: las guarda scripts/empretienda-metricas.mjs con el "mes" de Métricas en cada lectura (el
//   último valor del mes queda como cierre). Mayo a septiembre 2026 se cargaron una vez desde las órdenes del panel
//   (scripts/historico-empretienda.mjs).
// - Mercado Libre, Shopify y Mayorista: guardarMes() (cron diario de Vercel, el mes de "ayer": el día 1 cierra el mes).
import { google } from 'googleapis';
import { getAuth } from './sheets';
import { fetchOrdersInRange, isValidOrder } from './ml';
import { getShopifyVentasRango } from './shopify';

const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const TAB = 'historico_mensual';
// Nombre de la pestaña mensual de Mayorista ("SEPT 26", no "SEP 26").
const MAY_TAB = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEPT', 'OCT', 'NOV', 'DIC'];

export type FilaHist = { mes: string; canal: string; monto: number; ventas: number; fuente: string; actualizado: string };

const parseMonto = (v: unknown) =>
  typeof v === 'number' ? v : Number(String(v ?? '').replace(/[$\s.]/g, '').replace(',', '.')) || 0;

export async function getHistorico(): Promise<FilaHist[]> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values
    .get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:F`, valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  return (r?.data.values ?? []).map((x) => ({
    mes: String(x[0]),
    canal: String(x[1]),
    monto: Number(x[2]) || 0,
    ventas: Number(x[3]) || 0,
    fuente: String(x[4] ?? ''),
    actualizado: String(x[5] ?? ''),
  }));
}

// Reemplaza las filas (mes, canal) dadas y deja el resto.
export async function upsertHistorico(nuevas: FilaHist[]) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' });
  if (!meta.data.sheets?.some((s) => s.properties?.title === TAB)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
  }
  const clave = (f: { mes: string; canal: string }) => `${f.mes}|${f.canal}`;
  const reemplazar = new Set(nuevas.map(clave));
  const todas = [...(await getHistorico()).filter((f) => !reemplazar.has(clave(f))), ...nuevas].sort(
    (a, b) => a.mes.localeCompare(b.mes) || a.canal.localeCompare(b.canal),
  );
  await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A:F` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['mes', 'canal', 'monto', 'ventas', 'fuente', 'actualizado'], ...todas.map((f) => [f.mes, f.canal, Math.round(f.monto), f.ventas, f.fuente, f.actualizado])],
    },
  });
}

// Primer y último día (YYYY-MM-DD) de un mes YYYY-MM.
function limites(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { desde: `${mes}-01`, hasta: fin };
}

// Calcula y guarda Mercado Libre, Shopify y Mayorista de un mes (mismos criterios que la tabla de /canales).
export async function guardarMes(mes: string) {
  const { desde, hasta } = limites(mes);
  const ahora = new Date().toISOString();
  const finMes = new Date(`${hasta}T23:59:59.999-03:00`);
  const [ml, shop, may] = await Promise.all([
    fetchOrdersInRange(new Date(`${desde}T00:00:00-03:00`), finMes < new Date() ? finMes : new Date()).then((all) => {
      const os = all.filter(isValidOrder);
      return { monto: os.reduce((s, o) => s + (o.total_amount || 0), 0), ventas: new Set(os.map((o) => o.pack_id ?? o.id)).size };
    }),
    getShopifyVentasRango(desde, hasta).catch(() => null),
    (async () => {
      // Pestaña del mes ("SEPT 26"; febrero 2026 quedó como "FEB 26."). Fila 1 = títulos, fila 2 = totales (A = pedidos).
      // La columna del total se busca por su título: hasta marzo 2026 "MONTO TOTAL" es la L y la M es "COSTO";
      // desde abril se agregó "CMV" y el total pasó a la M.
      const [y, m] = mes.split('-').map(Number);
      const base = `${MAY_TAB[m - 1]} ${String(y).slice(-2)}`;
      const sheets = google.sheets({ version: 'v4', auth: getAuth() });
      const titulos = (await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties.title' })).data.sheets?.map((x) => x.properties?.title ?? '') ?? [];
      const tab = titulos.find((t) => t.trim().replace(/\.$/, '') === base);
      if (!tab) throw new Error(`No hay pestaña ${base}`);
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${tab}'!A1:Z2`, valueRenderOption: 'UNFORMATTED_VALUE' });
      const [cab = [], tot = []] = r.data.values ?? [];
      const col = cab.findIndex((c) => /MONTO\s*TOTAL/i.test(String(c)));
      if (col < 0) throw new Error(`No encontré "MONTO TOTAL" en ${tab}`);
      return { monto: parseMonto(tot[col]), ventas: Number(tot[0]) || 0, tab };
    })().catch(() => null),
  ]);
  const filas: FilaHist[] = [{ mes, canal: 'ml', monto: ml.monto, ventas: ml.ventas, fuente: 'API Mercado Libre', actualizado: ahora }];
  if (shop) filas.push({ mes, canal: 'shopify', monto: shop.amount, ventas: shop.orders, fuente: 'API Shopify', actualizado: ahora });
  if (may) filas.push({ mes, canal: 'mayorista', monto: may.monto, ventas: may.ventas, fuente: `Planilla mayorista (${may.tab})`, actualizado: ahora });
  await upsertHistorico(filas);
  return filas;
}
