import { conCache } from '@/lib/cache';
import { reporte } from '@/lib/ga4';
import { fetchVisitas } from '@/lib/ml';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

// Visitas del período por canal (?periodo=hoy|ayer|semana|mes): Tienda Online = sesiones de GA4 (www.mateandoarg.com);
// Mercado Libre = visitas a las publicaciones (API de ML). Shopify todavía no tiene fuente de visitas.
async function obtener(req: Request) {
  const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
  const desde = desdeAR(periodo);
  const hasta = hastaAR(periodo);
  const [online, ml] = await Promise.all([
    reporte({ desde, hasta, metricas: ['sessions'] }).then((f) => f[0]?.vals[0] ?? 0).catch(() => null),
    fetchVisitas(desde, hasta).catch(() => null),
  ]);
  return Response.json({ online, ml });
}

export const GET = conCache(obtener, 600);
