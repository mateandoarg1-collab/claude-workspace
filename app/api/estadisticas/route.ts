import { ACORDAR, getOrdenes, PAGO, type Orden } from '@/lib/empretiendaOrdenes';
import { pagina, reporte } from '@/lib/ga4';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

export const maxDuration = 30;

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dia = (s: string, d: number) => {
  const x = new Date(`${s}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

// Estadísticas de la tienda online (?periodo=hoy|ayer|semana|mes) al estilo "Estadísticas Nube".
// Visitas y navegación: GA4. Ventas: órdenes reales de Empretienda (pestaña emp_ordenes), sin Acordar (= Local).
// Canal de cada venta: la página de gracias (/order) trae el order_id en la URL, así que se cruza la orden real con
// el canal de la sesión de GA4 en la que se compró. Lo que GA4 no vio queda como "Sin rastrear".
// Compara contra el período anterior de igual largo.
export async function GET(req: Request) {
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const desde = desdeAR(periodo);
    const hasta = hastaAR(periodo);
    const largo = Math.round((Date.parse(hasta) - Date.parse(desde)) / 864e5) + 1;
    const prev = { desde: dia(desde, -largo), hasta: dia(hasta, -largo) };
    const graficoDesde = largo < 14 ? dia(hasta, -13) : desde;

    const { ordenes, productos } = await getOrdenes();
    // Producto = /categoria/<link de un producto del catálogo>. Las subcategorías (/mates/madera) no entran.
    const PRODUCTO = `^/[^/]+/(${productos.map((p) => escapar(p.link)).filter(Boolean).join('|')})$`;
    const porLink = new Map(productos.map((p) => [p.link, p]));

    const ga = async (r: { desde: string; hasta: string }) => {
      const [tot, prod, chk] = await Promise.all([
        reporte({ ...r, metricas: ['sessions', 'totalUsers', 'averageSessionDuration'] }),
        reporte({ ...r, metricas: ['sessions'], filtros: [pagina(PRODUCTO)] }),
        reporte({ ...r, metricas: ['sessions'], filtros: [pagina('^/checkout.*')] }),
      ]);
      const t = tot[0]?.vals ?? [];
      return { visitas: t[0] ?? 0, usuarios: t[1] ?? 0, duracion: t[2] ?? 0, producto: prod[0]?.vals[0] ?? 0, checkout: chk[0]?.vals[0] ?? 0 };
    };

    const [gaAct, gaAnt, diario, canales, gracias, dispositivos, vistas, regiones] = await Promise.all([
      ga({ desde, hasta }),
      ga(prev),
      reporte({ desde: graficoDesde, hasta, dims: ['date'], metricas: ['sessions'], orden: { dim: 'date' } }),
      reporte({ desde, hasta, dims: ['sessionDefaultChannelGroup'], metricas: ['sessions'], orden: { metrica: 'sessions' } }),
      reporte({ desde, hasta, dims: ['pagePathPlusQueryString', 'sessionDefaultChannelGroup'], metricas: ['sessions'], filtros: [pagina('/order')], limite: 20000 }),
      reporte({ desde, hasta, dims: ['deviceCategory'], metricas: ['sessions'], orden: { metrica: 'sessions' } }),
      reporte({ desde, hasta, dims: ['pagePath'], metricas: ['sessions'], filtros: [pagina(PRODUCTO)], orden: { metrica: 'sessions' }, limite: 500 }),
      reporte({ desde, hasta, dims: ['region'], metricas: ['sessions'], orden: { metrica: 'sessions' }, limite: 30 }),
    ]);

    // Órdenes online (sin Acordar) por período
    const online = (o: Orden) => o.metodo !== ACORDAR;
    const en = (r: { desde: string; hasta: string }) => ordenes.filter((o) => online(o) && o.dia >= r.desde && o.dia <= r.hasta);
    const resumen = (os: Orden[]) => {
      const pagadas = os.filter((o) => o.pago === PAGO.pagada);
      const monto = pagadas.reduce((s, o) => s + o.total, 0);
      return {
        intentos: os.length,
        pagadas: pagadas.length,
        monto,
        pendientes: os.filter((o) => o.pago === PAGO.pendiente).length,
        montoPendiente: os.filter((o) => o.pago === PAGO.pendiente).reduce((s, o) => s + o.total, 0),
        fallidas: os.filter((o) => o.pago === PAGO.fallida).length,
        montoFallido: os.filter((o) => o.pago === PAGO.fallida).reduce((s, o) => s + o.total, 0),
      };
    };
    const ordAct = en({ desde, hasta });
    const pagAct = ordAct.filter((o) => o.pago === PAGO.pagada);

    // Canal de cada orden según GA4 (order_id de la URL de la página de gracias)
    const canalDe = new Map<string, string>();
    for (const f of gracias) {
      const id = new URLSearchParams(f.dims[0].split('?')[1] ?? '').get('order_id');
      if (id) canalDe.set(id, f.dims[1]);
    }
    const porCanal = new Map<string, { ventas: number; monto: number }>();
    for (const o of pagAct) {
      const c = canalDe.get(o.id) ?? 'Sin rastrear';
      const x = porCanal.get(c) ?? { ventas: 0, monto: 0 };
      x.ventas += 1;
      x.monto += o.total;
      porCanal.set(c, x);
    }
    const nombresCanal = [...new Set([...canales.map((f) => f.dims[0]), ...porCanal.keys()])];

    // Productos: visitas (GA4) vs unidades pagadas (Empretienda)
    const vendidas = new Map<string, number>();
    for (const o of pagAct) for (const p of o.productos) vendidas.set(p.id, (vendidas.get(p.id) ?? 0) + p.cant);
    const visitasProd = new Map<string, number>();
    const pathProd = new Map<string, string>(); // la URL con más visitas de cada producto (puede estar en varias categorías)
    for (const f of vistas) {
      const p = porLink.get(f.dims[0].split('/')[2]);
      if (!p) continue;
      visitasProd.set(p.id, (visitasProd.get(p.id) ?? 0) + f.vals[0]);
      if (!pathProd.has(p.id)) pathProd.set(p.id, f.dims[0]);
    }
    const tabla = productos
      .map((p) => ({ id: p.id, nombre: p.nombre, imagen: p.imagen, path: pathProd.get(p.id) ?? null, visitas: visitasProd.get(p.id) ?? 0, vendidas: vendidas.get(p.id) ?? 0 }))
      .filter((p) => p.visitas || p.vendidas);

    // Por día: visitas GA4 + ventas pagadas
    const ventasDia = new Map<string, { ventas: number; monto: number }>();
    for (const o of ordenes) {
      if (!online(o) || o.pago !== PAGO.pagada || o.dia < graficoDesde) continue;
      const x = ventasDia.get(o.dia) ?? { ventas: 0, monto: 0 };
      x.ventas += 1;
      x.monto += o.total;
      ventasDia.set(o.dia, x);
    }

    const provincias = new Map<string, { ventas: number; monto: number }>();
    for (const o of pagAct) {
      const k = o.provincia || 'Sin dato';
      const x = provincias.get(k) ?? { ventas: 0, monto: 0 };
      x.ventas += 1;
      x.monto += o.total;
      provincias.set(k, x);
    }

    return Response.json({
      periodo,
      desde,
      hasta,
      actual: { ...gaAct, ...resumen(ordAct) },
      anterior: { ...gaAnt, ...resumen(en(prev)) },
      rastreadas: pagAct.filter((o) => canalDe.has(o.id)).length,
      diario: diario.map((f) => {
        const d = `${f.dims[0].slice(0, 4)}-${f.dims[0].slice(4, 6)}-${f.dims[0].slice(6)}`;
        return { dia: d, visitas: f.vals[0], ...(ventasDia.get(d) ?? { ventas: 0, monto: 0 }) };
      }),
      canales: nombresCanal
        .map((c) => ({ nombre: c, visitas: canales.find((f) => f.dims[0] === c)?.vals[0] ?? 0, ...(porCanal.get(c) ?? { ventas: 0, monto: 0 }) }))
        .sort((a, b) => b.monto - a.monto || b.visitas - a.visitas),
      dispositivos: dispositivos.map((f) => ({ nombre: f.dims[0], visitas: f.vals[0] })),
      masVistos: [...tabla].sort((a, b) => b.visitas - a.visitas).slice(0, 15),
      masVendidos: [...tabla].sort((a, b) => b.vendidas - a.vendidas).slice(0, 15),
      provincias: [...provincias].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.ventas - a.ventas),
      regiones: regiones.map((f) => ({ nombre: f.dims[0], visitas: f.vals[0] })),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
