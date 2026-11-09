import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// Productos que se venden solo en el local (no están en Empretienda), cargados por las chicas desde la caja con foto
// (miniatura JPEG en base64, ~15 KB, entra en una celda). Pestaña "Productos Local" de la planilla de efectivo.
// Columnas: id · nombre · precio · foto · alta · estado (ok/borrado).
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const HOJA = 'Productos Local';
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin' };
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

async function filas() {
  const s = sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: ID, range: `'${HOJA}'!A2:F` }).catch(() => null);
  if (r) return r.data.values ?? [];
  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: HOJA, gridProperties: { frozenRowCount: 1 } } } }] } });
  await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!A1`, valueInputOption: 'RAW', requestBody: { values: [['id', 'nombre', 'precio', 'foto', 'alta', 'estado']] } });
  return [];
}

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET() {
  try {
    const productos = (await filas()).filter((f) => f[0] && f[5] !== 'borrado').map((f) => ({ id: f[0], nombre: f[1], precio: Number(f[2]) || 0, img: f[3] || '' }));
    return Response.json({ productos }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const v = await filas();
    if (b.borrar) {
      const i = v.findIndex((f) => f[0] === String(b.borrar));
      if (i < 0) return Response.json({ error: 'No existe' }, { status: 404, headers: CORS });
      await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!F${i + 2}`, valueInputOption: 'RAW', requestBody: { values: [['borrado']] } });
      return Response.json({ ok: true }, { headers: CORS });
    }
    const nombre = String(b.nombre ?? '').trim().slice(0, 120), precio = Math.round(Number(b.precio) || 0);
    const foto = String(b.foto ?? '');
    if (!nombre || !(precio > 0)) return Response.json({ error: 'Falta nombre o precio' }, { status: 400, headers: CORS });
    if (foto && (!foto.startsWith('data:image/jpeg;base64,') || foto.length > 45000)) return Response.json({ error: 'Foto inválida o muy grande' }, { status: 400, headers: CORS });
    const id = `L${Date.now().toString(36)}`;
    const alta = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!A${v.length + 2}:F${v.length + 2}`, valueInputOption: 'RAW',
      requestBody: { values: [[id, nombre, precio, foto, alta, 'ok']] } });
    return Response.json({ ok: true, id }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
