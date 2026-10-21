import { getCostoPosventa } from '@/lib/posventa';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

// Costo de posventa por canal del período (?periodo=hoy|ayer|semana|mes), para restarlo del margen en /canales.
export async function GET(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    return Response.json(await getCostoPosventa(desdeAR(periodo), hastaAR(periodo)));
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
