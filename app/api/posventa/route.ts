import { getFotosSku, getReclamos, getUnidadesSku, type Reclamo } from '@/lib/posventa';

export const maxDuration = 30;

// Panel de posventa (?mes=YYYY-MM o "todo"): reclamos por mes, motivo, producto, responsable y canal, pendientes y
// % de falla por SKU (reclamos de Tienda Online + Local ÷ unidades vendidas en Empretienda los mismos meses).
export async function GET(req: Request) {
  try {
    const mes = new URL(req.url).searchParams.get('mes') ?? 'todo';
    const [{ reclamos, nombres }, unidades, fotos] = await Promise.all([getReclamos(), getUnidadesSku(), getFotosSku().catch(() => ({}) as Record<string, string>)]);
    const delMes = (r: Reclamo) => mes === 'todo' || r.fecha?.slice(0, 7) === mes;
    const sel = reclamos.filter(delMes);

    const porMes = new Map<string, { reclamos: number; costo: number }>();
    for (const r of reclamos) {
      if (!r.fecha) continue;
      const m = porMes.get(r.fecha.slice(0, 7)) ?? { reclamos: 0, costo: 0 };
      m.reclamos += 1;
      m.costo += r.costo;
      porMes.set(r.fecha.slice(0, 7), m);
    }

    const agrupar = (clave: (r: Reclamo) => string) => {
      const m = new Map<string, { nombre: string; reclamos: number; costo: number }>();
      for (const r of sel) {
        const k = clave(r);
        const x = m.get(k) ?? { nombre: k, reclamos: 0, costo: 0 };
        x.reclamos += 1;
        x.costo += r.costo;
        m.set(k, x);
      }
      return [...m.values()].sort((a, b) => b.reclamos - a.reclamos || b.costo - a.costo);
    };

    // % de falla: solo meses con unidades cargadas (desde oct-2026) y reclamos de Empretienda (Tienda Online + Local).
    const mesesU = new Set(unidades.map((u) => u.mes));
    const vendidas = new Map<string, number>();
    for (const u of unidades) if (mes === 'todo' || u.mes === mes) vendidas.set(u.sku, (vendidas.get(u.sku) ?? 0) + u.online + u.local);
    const reclEmp = new Map<string, number>();
    for (const r of sel) {
      if (!r.sku || !r.fecha || !mesesU.has(r.fecha.slice(0, 7)) || (r.canal !== 'online' && r.canal !== 'local')) continue;
      reclEmp.set(r.sku, (reclEmp.get(r.sku) ?? 0) + 1);
    }

    const productos = agrupar((r) => r.sku ?? `?${r.producto.toUpperCase()}`).map((p) => {
      const sku = p.nombre.startsWith('?') ? null : p.nombre;
      const u = sku ? vendidas.get(sku) ?? 0 : 0;
      const rc = sku ? reclEmp.get(sku) ?? 0 : 0;
      return {
        sku,
        nombre: sku ? nombres[sku] ?? sku : p.nombre.slice(1),
        reclamos: p.reclamos,
        costo: Math.round(p.costo),
        foto: sku ? fotos[sku] ?? null : null,
        vendidas: u,
        reclamosEmp: rc, // los que entran en el % (Tienda Online + Local, meses con unidades)
        falla: u >= 10 ? rc / u : null, // con menos de 10 vendidas el % no dice nada
      };
    });

    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
    const pendientes = reclamos
      .filter((r) => /pendiente|proceso/i.test(r.estado))
      .map((r) => ({ ...r, abierto: r.fecha ? Math.round((Date.parse(hoy) - Date.parse(r.fecha)) / 864e5) : null }))
      .sort((a, b) => (b.abierto ?? 0) - (a.abierto ?? 0));

    const conDias = sel.filter((r) => r.dias != null);
    return Response.json({
      mes,
      meses: [...porMes].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ mes: m, ...v, costo: Math.round(v.costo) })),
      resumen: {
        reclamos: sel.length,
        costo: Math.round(sel.reduce((s, r) => s + r.costo, 0)),
        pendientes: pendientes.length,
        diasProm: conDias.length ? conDias.reduce((s, r) => s + (r.dias ?? 0), 0) / conDias.length : null,
        sinFecha: reclamos.filter((r) => !r.fecha).length,
      },
      motivos: agrupar((r) => r.motivo).map((x) => ({ ...x, costo: Math.round(x.costo) })),
      responsables: agrupar((r) => r.responsable).map((x) => ({ ...x, costo: Math.round(x.costo) })),
      canales: agrupar((r) => r.canal).map((x) => ({ ...x, costo: Math.round(x.costo) })),
      productos,
      pendientes: pendientes.slice(0, 50),
      mesesConFalla: [...mesesU].sort(),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
