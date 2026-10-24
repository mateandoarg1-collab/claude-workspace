import { evento, pagina, reporte } from '@/lib/ga4';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';
import { getEmpretiendaMetricas } from '@/lib/sheets';

export const maxDuration = 30;

// Producto = página de 2 niveles (/categoria/producto). Algunas subcategorías (/mates/madera) también entran: es aproximado,
// porque Empretienda no manda view_item a GA4. Checkout → /checkout, compra → evento Compra_Finalizada (página /order).
const PRODUCTO = '^/[^/]+/[^/]+$';
const NO_CHECKOUT = { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: '/checkout' } } };

const dia = (s: string, d: number) => {
  const x = new Date(`${s}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

// Estadísticas de la tienda online (?periodo=hoy|ayer|semana|mes) al estilo "Estadísticas Nube": visitas y embudo de GA4,
// ventas y facturación de Empretienda (sin "Acordar" = Local). Compara contra el período anterior de igual largo.
export async function GET(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const desde = desdeAR(periodo);
    const hasta = hastaAR(periodo);
    const largo = Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1;
    const prev = { desde: dia(desde, -largo), hasta: dia(hasta, -largo) };

    const base = ['sessions', 'totalUsers', 'newUsers', 'screenPageViews', 'averageSessionDuration', 'bounceRate'];
    const embudo = async (r: { desde: string; hasta: string }) => {
      const [tot, prod, chk, compra] = await Promise.all([
        reporte({ ...r, metricas: base }),
        reporte({ ...r, metricas: ['sessions'], filtros: [pagina(PRODUCTO), { notExpression: NO_CHECKOUT }] }),
        reporte({ ...r, metricas: ['sessions'], filtros: [pagina('^/checkout.*')] }),
        reporte({ ...r, metricas: ['sessions', 'eventCount'], filtros: [evento('Compra_Finalizada')] }),
      ]);
      const t = tot[0]?.vals ?? [];
      return {
        visitas: t[0] ?? 0,
        usuarios: t[1] ?? 0,
        nuevos: t[2] ?? 0,
        paginas: t[3] ?? 0,
        duracion: t[4] ?? 0,
        rebote: t[5] ?? 0,
        producto: prod[0]?.vals[0] ?? 0,
        checkout: chk[0]?.vals[0] ?? 0,
        compras: compra[0]?.vals[0] ?? 0,
      };
    };

    const [actual, anterior, diario, comprasDia, canales, comprasCanal, dispositivos, productos, ciudades, emp] = await Promise.all([
      embudo({ desde, hasta }),
      embudo(prev),
      reporte({ desde: largo < 7 ? dia(hasta, -13) : desde, hasta, dims: ['date'], metricas: ['sessions'], orden: { dim: 'date' } }),
      reporte({ desde: largo < 7 ? dia(hasta, -13) : desde, hasta, dims: ['date'], metricas: ['sessions'], filtros: [evento('Compra_Finalizada')] }),
      reporte({ desde, hasta, dims: ['sessionDefaultChannelGroup'], metricas: ['sessions'], orden: { metrica: 'sessions' } }),
      reporte({ desde, hasta, dims: ['sessionDefaultChannelGroup'], metricas: ['sessions'], filtros: [evento('Compra_Finalizada')] }),
      reporte({ desde, hasta, dims: ['deviceCategory'], metricas: ['sessions'], orden: { metrica: 'sessions' } }),
      reporte({ desde, hasta, dims: ['pagePath', 'pageTitle'], metricas: ['screenPageViews', 'sessions'], filtros: [pagina(PRODUCTO)], orden: { metrica: 'screenPageViews' }, limite: 15 }),
      reporte({ desde, hasta, dims: ['region'], metricas: ['sessions'], orden: { metrica: 'sessions' }, limite: 10 }),
      getEmpretiendaMetricas().catch(() => []),
    ]);

    const compraPorDia = new Map(comprasDia.map((f) => [f.dims[0], f.vals[0]]));
    const compraPorCanal = new Map(comprasCanal.map((f) => [f.dims[0], f.vals[0]]));
    const e = emp.find((m) => m.periodo === periodo && m.desde === desde);

    return Response.json({
      periodo,
      desde,
      hasta,
      prev,
      actual,
      anterior,
      // Ventas reales de Empretienda (total − Acordar, que es el Local): solo para el período actual.
      empretienda: e ? { ventas: e.totalCant - e.acordarCant, monto: e.totalMonto - e.acordarMonto, updatedAt: e.updatedAt } : null,
      diario: diario.map((f) => {
        const d = f.dims[0];
        return { dia: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, visitas: f.vals[0], compras: compraPorDia.get(d) ?? 0 };
      }),
      canales: canales.map((f) => ({ nombre: f.dims[0], visitas: f.vals[0], compras: compraPorCanal.get(f.dims[0]) ?? 0 })),
      dispositivos: dispositivos.map((f) => ({ nombre: f.dims[0], visitas: f.vals[0] })),
      productos: productos.map((f) => ({ path: f.dims[0], titulo: f.dims[1].replace(/\s*[-|]\s*MATEANDO.*$/i, ''), vistas: f.vals[0], visitas: f.vals[1] })),
      regiones: ciudades.map((f) => ({ nombre: f.dims[0], visitas: f.vals[0] })),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
