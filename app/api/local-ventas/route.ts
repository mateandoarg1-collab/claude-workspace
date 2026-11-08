import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// Ventas de la caja del local (mateando-local.vercel.app). Desde el 8-nov-2026 el local va separado de Empretienda:
// cada venta se guarda acá con N° de pedido propio y correlativo, en la pestaña "Ventas Caja" de la planilla
// "Mateando_Flujo_Efectivo COSTA RICA". GET lista (más nuevas primero); POST guarda una venta o anula ({anular: nro}).
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const HOJA = 'Ventas Caja';
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin' };

function sinPermiso(req: Request) {
  const pin = process.env.LOCAL_CAJA_PIN;
  if (!pin || req.headers.get('x-pin') === pin) return null;
  return Response.json({ error: 'Clave incorrecta' }, { status: 401, headers: CORS });
}
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
const filas = async () => (await sheets().spreadsheets.values.get({ spreadsheetId: ID, range: `'${HOJA}'!A2:P`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
const n = (x: unknown) => Math.round(Number(x) || 0);
const txt = (x: unknown, max: number) => String(x ?? '').slice(0, max);

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const ventas = (await filas()).filter((f) => f[0]).map((f) => {
      let items = []; try { items = JSON.parse(f[15] || '[]'); } catch {}
      return { nro: n(f[0]), fecha: f[1], dia: f[2], hora: f[3], cajera: f[4], medio: f[5], sub: n(f[6]), dTransf: n(f[7]), conDesc: n(f[8]),
        d: Number(f[9]) || 0, total: n(f[10]), unidades: n(f[11]), com: f[13] ?? '', estado: f[14] || 'ok', items };
    }).reverse();
    return Response.json({ ventas }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const b = await req.json();
    const v = await filas();
    if (b.anular) {
      const i = v.findIndex((f) => n(f[0]) === n(b.anular));
      if (i < 0) return Response.json({ error: 'No existe ese pedido' }, { status: 404, headers: CORS });
      await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!O${i + 2}`, valueInputOption: 'RAW', requestBody: { values: [['anulada']] } });
      return Response.json({ ok: true }, { headers: CORS });
    }
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((i: Record<string, unknown>) => ({
      nombre: txt(i.nombre, 160), cant: n(i.cant) || 1, precio: n(i.precio), local: !!i.local }));
    if (!items.length) return Response.json({ error: 'Venta sin productos' }, { status: 400, headers: CORS });
    const nro = Math.max(0, ...v.map((f) => n(f[0]))) + 1;
    const ahora = new Date(Date.now() - 3 * 3600e3);
    const dia = ahora.toISOString().slice(0, 10).split('-').reverse().join('/');
    const hora = ahora.toISOString().slice(11, 16);
    const fila = [nro, ahora.toISOString().slice(0, 16).replace('T', ' '), dia, hora, txt(b.cajera, 40), txt(b.medio, 30), n(b.sub), n(b.dTransf),
      n(b.conDesc), Number(b.d) || 0, n(b.total), items.reduce((s: number, i: { cant: number }) => s + i.cant, 0),
      items.map((i: { cant: number; nombre: string }) => `${i.cant}x ${i.nombre}`).join(' | '), txt(b.com, 300), 'ok', JSON.stringify(items)];
    await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!A${v.length + 2}:P${v.length + 2}`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
    return Response.json({ ok: true, nro, dia, hora }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
