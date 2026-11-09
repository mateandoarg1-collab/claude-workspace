import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { ventas } from '@/lib/localCajaVentas';
import { setCostoTienda } from '@/lib/costosTienda';

export const dynamic = 'force-dynamic';

// Métricas de la caja del local, solo con la clave del dueño (LOCAL_METRICAS_CLAVE en Vercel), así las chicas no ven
// el total vendido: histórico del local en Empretienda, rentabilidad de cada venta de la caja (pestaña "Rentabilidad
// Local", la escribe scripts/local-rentabilidad.mjs cada hora en DonWeb) y los costos fijos del local
// (costos_adicionales, canal local). POST {producto, costo}: carga a mano el costo sin IVA de un producto (costos_tienda).
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'x-clave,content-type' };
const EFECTIVO = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const MAYORISTA = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

const sinClave = (req: Request) => {
  const clave = process.env.LOCAL_METRICAS_CLAVE;
  return !clave || req.headers.get('x-clave') !== clave ? Response.json({ error: 'Clave incorrecta' }, { status: 401, headers: CORS }) : null;
};

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET(req: Request) {
  const no = sinClave(req); if (no) return no;
  try {
    const s = google.sheets({ version: 'v4', auth: getAuth() });
    const [v, rent, fijos] = await Promise.all([
      ventas(),
      s.spreadsheets.values.get({ spreadsheetId: EFECTIVO, range: "'Rentabilidad Local'!A2:N", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null),
      s.spreadsheets.values.get({ spreadsheetId: MAYORISTA, range: "'costos_adicionales'!A2:G", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null),
    ]);
    const rentabilidad = (rent?.data.values ?? []).map((f) => ({
      nro: Number(f[0]), dia: String(f[2]), venta: Number(f[3]) || 0, cmv: (Number(f[4]) || 0) + (Number(f[5]) || 0), comision: Number(f[6]) || 0,
      impuestos: (Number(f[7]) || 0) + (Number(f[8]) || 0) + (Number(f[9]) || 0), financiera: Number(f[10]) || 0, ganancia: Number(f[11]) || 0,
      sinCosto: f[12] ? String(f[12]).split(' | ') : [], actualizado: f[13] ?? '' }));
    // fijos del local por mes, con su vigencia (desde/hasta)
    const fijosLocal = (fijos?.data.values ?? []).filter((f) => f[6] === 'local' && f[1] === 'fijo')
      .map((f) => ({ nombre: String(f[0]), monto: Number(f[2]) || 0, desde: String(f[4] || ''), hasta: String(f[5] || '') }));
    return Response.json({ actualizado: new Date().toISOString(), ventas: v.lista, rentabilidad, fijosLocal }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: Request) {
  const no = sinClave(req); if (no) return no;
  try {
    const b = await req.json();
    const producto = String(b.producto ?? '').trim(), costo = Number(b.costo);
    if (!producto || !(costo >= 0)) return Response.json({ error: 'Falta producto o costo' }, { status: 400, headers: CORS });
    await setCostoTienda(producto, costo);
    return Response.json({ ok: true }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
