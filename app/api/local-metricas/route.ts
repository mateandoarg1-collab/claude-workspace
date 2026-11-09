import { ventas } from '@/lib/localCajaVentas';

export const dynamic = 'force-dynamic';

// Histórico de ventas del local en Empretienda para la solapa Métricas de la caja: solo con la clave del dueño
// (LOCAL_METRICAS_CLAVE en Vercel), así las chicas no ven el total vendido.
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-headers': 'x-clave' };

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET(req: Request) {
  const clave = process.env.LOCAL_METRICAS_CLAVE;
  if (!clave || req.headers.get('x-clave') !== clave) return Response.json({ error: 'Clave incorrecta' }, { status: 401, headers: CORS });
  try {
    const v = await ventas();
    return Response.json({ actualizado: new Date().toISOString(), ventas: v.lista }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
