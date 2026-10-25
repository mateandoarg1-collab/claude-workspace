// Dólar blue: cotización de hoy (dolarapi.com) y promedio mensual del blue venta (api.argentinadatos.com, histórico
// diario). Se usa la VENTA: lo que costaría comprar dólares con los pesos vendidos. Cacheado 1 h.
type Dia = { fecha: string; compra: number; venta: number };

export async function GET() {
  try {
    const [hoy, hist] = await Promise.all([
      fetch('https://dolarapi.com/v1/dolares/blue', { next: { revalidate: 3600 } }).then((r) => r.json()),
      fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/blue', { next: { revalidate: 3600 } })
        .then((r) => r.json() as Promise<Dia[]>)
        .catch(() => [] as Dia[]),
    ]);
    const acum = new Map<string, { s: number; n: number }>();
    for (const d of hist) {
      if (d.fecha < '2025-01-01' || !d.venta) continue;
      const m = acum.get(d.fecha.slice(0, 7)) ?? { s: 0, n: 0 };
      m.s += d.venta;
      m.n += 1;
      acum.set(d.fecha.slice(0, 7), m);
    }
    const meses = Object.fromEntries([...acum].map(([mes, { s, n }]) => [mes, Math.round(s / n)]));
    return Response.json({ compra: hoy.compra, venta: hoy.venta, fecha: hoy.fechaActualizacion, meses });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
