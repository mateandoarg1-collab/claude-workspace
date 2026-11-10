import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { getCostosTienda, normalizar, setCostoTienda } from '@/lib/costosTienda';

export const dynamic = 'force-dynamic';

// Solapa "Pendientes" de la caja del local (sin clave, la usan las chicas): productos vendidos en la caja que no
// tienen costo. Salen de dos lados: los "sin costo" que calcula scripts/local-rentabilidad.mjs cada hora (pestaña
// Rentabilidad Local) y los productos del local ([LOCAL]) vendidos que todavía no tienen costo a mano, así aparecen
// apenas se venden. Se descuentan los que ya tienen costo en costos_tienda. No devuelve montos de venta.
// POST {producto, costo}: carga el costo sin IVA (costo 0 = "no es un producto", ej. diferencia de un cambio).
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
const EFECTIVO = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET() {
  try {
    const s = google.sheets({ version: 'v4', auth: getAuth() });
    const [ventas, rent, costos] = await Promise.all([
      s.spreadsheets.values.get({ spreadsheetId: EFECTIVO, range: "'Ventas Caja'!A2:P", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null),
      s.spreadsheets.values.get({ spreadsheetId: EFECTIVO, range: "'Rentabilidad Local'!A2:M", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null),
      getCostosTienda(),
    ]);
    const conCosto = new Set(costos.map((c) => normalizar(c.producto)));
    const pend = new Map<string, { producto: string; veces: number; ultimo: number; dia: string }>();
    const sumar = (producto: string, nro: number, dia: string) => {
      const k = normalizar(producto);
      if (!k || conCosto.has(k)) return;
      const p = pend.get(k) ?? { producto, veces: 0, ultimo: 0, dia: '' };
      p.veces++;
      if (nro > p.ultimo) { p.ultimo = nro; p.dia = dia; }
      pend.set(k, p);
    };
    const filas = (ventas?.data.values ?? []).filter((f) => f[0] && f[14] !== 'anulada');
    const vistos = new Set<string>();
    for (const f of filas) {
      let items: { nombre: string; local?: boolean; n?: string }[] = [];
      try { items = JSON.parse(f[15] || '[]'); } catch {}
      for (const it of items.filter((x) => x.local)) { const n = it.n || it.nombre.replace(/ \[.*?\]/g, ''); sumar(n, Number(f[0]), String(f[2])); vistos.add(`${f[0]}|${normalizar(n)}`); }
    }
    for (const f of rent?.data.values ?? [])
      for (const n of f[12] ? String(f[12]).split(' | ') : []) if (!vistos.has(`${f[0]}|${normalizar(n)}`)) sumar(n, Number(f[0]), String(f[2]));
    const lista = [...pend.values()].sort((a, b) => b.ultimo - a.ultimo);
    return Response.json({ pendientes: lista }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const producto = String(b.producto ?? '').trim(), costo = Number(b.costo);
    if (!producto || !(costo >= 0) || costo > 5_000_000) return Response.json({ error: 'Falta producto o costo' }, { status: 400, headers: CORS });
    await setCostoTienda(producto, costo);
    return Response.json({ ok: true }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
