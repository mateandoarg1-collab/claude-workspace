'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

export type VentaFila = {
  order_id: string; pack_id: string; fecha: string; creada: string; titulo: string; item_id: string; foto: string | null;
  logistica: string; venta: number; neto: number; sin_costo: number; flex_estimado: number; anulada: number;
  reembolsado: number; envio_devolucion: number;
};

type Detalle = {
  id: string;
  pack_id: string | null;
  envio: { estado: string | null; subestado: string | null; ciudad: string | null; provincia: string | null } | null;
  otros: { nombre: string; detalle: string; monto: number }[];
  ordenes: (VentaFila & {
    comision: number; envio_ml: number; envio_flex: number; impuestos: number; costo: number; unidades: number; estadoML: string | null;
    productos: { item_id: string; titulo: string; variante: string | null; cantidad: number; precio: number; precioLista: number | null; foto: string | null }[];
  })[];
};

const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCorto = (n: number) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('es-AR');
const pct = (n: number, de: number) => (de ? `${((n / de) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '–');
const LOGISTICA: Record<string, string> = { full: 'Full', flex: 'Flex', colecta: 'Colecta', agencia: 'Agencia', correo: 'Correo', 'sin envío': 'Sin envío' };
const ENVIO: Record<string, string> = {
  pending: 'Pendiente', handling: 'Preparando', ready_to_ship: 'Listo para enviar', shipped: 'En camino', delivered: 'Entregado',
  not_delivered: 'No entregado', cancelled: 'Cancelado',
};
// La hora la da ML en su zona; se muestra en hora argentina. Las filas viejas sin hora muestran solo el día.
const cuando = (v: { creada: string; fecha: string }) =>
  v.creada
    ? new Date(v.creada).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : new Date(`${v.fecha}T12:00:00Z`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const numero = (v: { pack_id: string; order_id: string }) => v.pack_id || `#${v.order_id}`;

function Estado({ v }: { v: VentaFila }) {
  const [texto, clase] = v.anulada
    ? ['Cancelada', 'bg-rose-500/10 text-rose-300 border-rose-500/30']
    : v.reembolsado > 0
      ? ['Reembolso parcial', 'bg-amber-500/10 text-amber-300 border-amber-500/30']
      : ['Pagado', 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap ${clase}`}>● {texto}</span>;
}

const PROBLEMAS = {
  sinCosto: { label: 'Sin costo de producto', es: (v: VentaFila) => v.sin_costo > 0 },
  flex: { label: 'Flex con cordón estimado', es: (v: VentaFila) => v.flex_estimado > 0 },
  devolucion: { label: 'Con devolución o cancelación', es: (v: VentaFila) => v.envio_devolucion > 0 || v.reembolsado > 0 || v.anulada > 0 },
} as const;
type Problema = keyof typeof PROBLEMAS;

function DetalleVenta({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const [d, setD] = useState<{ data?: Detalle; err?: string } | null>(null);
  useEffect(() => {
    fetch(`/api/ml/venta?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((x) => setD(x.error ? { err: x.error } : { data: x }))
      .catch((e) => setD({ err: String(e) }));
  }, [id]);
  useEffect(() => {
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [onCerrar]);

  const os = d?.data?.ordenes ?? [];
  const suma = (k: 'venta' | 'comision' | 'envio_ml' | 'envio_flex' | 'impuestos' | 'costo' | 'neto' | 'envio_devolucion') => os.reduce((s, o) => s + o[k], 0);
  const venta = suma('venta');
  const neto = suma('neto');
  const primera = os[0];
  const filasDesglose = primera
    ? [
        { nombre: 'Comisiones de Mercado Libre', valor: -suma('comision') },
        { nombre: 'Impuestos (5%)', valor: -suma('impuestos') },
        { nombre: 'Envío Flex propio', valor: -suma('envio_flex'), oculto: !suma('envio_flex') },
        { nombre: primera.logistica === 'flex' ? 'Envío Mercado Libre (bonificación Flex)' : 'Envío Mercado Libre', valor: -(suma('envio_ml') - suma('envio_devolucion')) },
        { nombre: 'Envío de devolución', valor: -suma('envio_devolucion') },
        { nombre: 'Costo de productos', valor: -suma('costo') },
      ].filter((f) => !f.oculto)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" onClick={onCerrar} role="dialog" aria-label={`Venta ${id}`}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-4 sm:p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-50 flex items-center gap-2 flex-wrap">
              Venta {primera ? numero(primera) : id}
              {primera && <Estado v={primera} />}
            </h3>
            {os.length > 0 && (
              <p className="text-xs text-slate-500 mt-0.5">
                {os.length > 1 ? `Carrito de ${os.length} órdenes: ${os.map((o) => o.order_id).join(', ')}` : `Orden ${primera?.order_id}`}
              </p>
            )}
          </div>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-100 text-xl leading-none px-1" aria-label="Cerrar">×</button>
        </div>

        {!d && <p className="text-sm text-slate-500 mt-6">Cargando venta…</p>}
        {d?.err && <p className="text-sm text-rose-400 mt-6">{d.err}</p>}

        {primera && (
          <>
            <div className="grid grid-cols-3 rounded-xl border border-slate-800 bg-slate-950/50 mt-4 divide-x divide-slate-800">
              {[['Venta sin IVA', fmt(venta)], ['Neto', fmt(neto)], ['Margen neto', pct(neto, venta)]].map(([k, v]) => (
                <div key={k} className="p-3 min-w-0">
                  <p className="text-[11px] text-slate-400">{k}</p>
                  <p className={`text-sm sm:text-base font-semibold tabular-nums mt-0.5 truncate ${k !== 'Venta sin IVA' && neto < 0 ? 'text-rose-400' : 'text-slate-50'}`}>{v}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-3 text-xs text-slate-300">
              <span className="rounded-lg border border-slate-800 px-2 py-1">🗓 {cuando(primera)}</span>
              <span className="rounded-lg border border-slate-800 px-2 py-1">
                🚚 {LOGISTICA[primera.logistica] ?? primera.logistica}
                {d?.data?.envio?.estado && ` · ${ENVIO[d.data.envio.estado] ?? d.data.envio.estado}`}
              </span>
              {d?.data?.envio?.provincia && (
                <span className="rounded-lg border border-slate-800 px-2 py-1">📍 {[d.data.envio.ciudad, d.data.envio.provincia].filter(Boolean).join(', ')}</span>
              )}
            </div>

            <h4 className="text-sm font-semibold text-slate-200 mt-5 mb-2">Productos</h4>
            <ul className="space-y-3">
              {os.flatMap((o) =>
                (o.productos.length ? o.productos : [{ item_id: o.item_id, titulo: o.titulo, variante: null, cantidad: o.unidades, precio: o.venta / (o.unidades || 1), precioLista: null, foto: o.foto }]).map((p, i) => (
                  <li key={`${o.order_id}-${i}`} className="flex items-start gap-3">
                    {p.foto ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.foto} alt="" className="w-11 h-11 rounded-lg object-cover bg-white border border-slate-800 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 rounded-lg bg-slate-950 border border-slate-800 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <a href={`https://articulo.mercadolibre.com.ar/${p.item_id.replace('MLA', 'MLA-')}`} target="_blank" rel="noreferrer"
                        className="block text-sm text-slate-100 truncate hover:text-emerald-300" title={p.titulo}>{p.titulo}</a>
                      {p.variante && <p className="text-[11px] text-slate-500">{p.variante}</p>}
                      <p className="text-xs text-slate-400 tabular-nums mt-0.5">
                        {p.precioLista && <span className="line-through text-slate-600 mr-1.5">{fmt(p.precioLista)}</span>}
                        {p.cantidad} × {fmt(p.precio)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500">Costo</p>
                      <p className="text-sm tabular-nums text-rose-300">{o.sin_costo ? 'sin cargar' : fmt(-o.costo)}</p>
                    </div>
                  </li>
                )),
              )}
            </ul>

            <h4 className="text-sm font-semibold text-slate-200 mt-5 mb-1">Desglose</h4>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-t border-slate-800/60 font-semibold">
                  <td className="py-2">Venta sin IVA</td>
                  <td className="py-2 text-right tabular-nums">{fmt(venta)}</td>
                </tr>
                {filasDesglose.map((f) => (
                  <tr key={f.nombre} className="border-t border-slate-800/60">
                    <td className="py-2 text-slate-300">{f.nombre}</td>
                    <td className={`py-2 text-right tabular-nums ${f.valor > 0.005 ? 'text-emerald-400' : f.valor < -0.005 ? 'text-rose-300' : 'text-slate-500'}`}>
                      {f.valor > 0.005 ? `+${fmt(f.valor)}` : fmt(f.valor)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-700 font-semibold">
                  <td className="py-2">Neto</td>
                  <td className={`py-2 text-right tabular-nums ${neto < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(neto)}</td>
                </tr>
              </tbody>
            </table>

            {(d?.data?.otros.length ?? 0) > 0 && (
              <div className="mt-3 rounded-xl border border-slate-800 p-3">
                <p className="text-[11px] text-slate-400 mb-1">Costos adicionales (no restan en el neto de la venta; se descuentan en la ganancia final)</p>
                {d!.data!.otros.map((c) => (
                  <div key={c.nombre} className="flex justify-between text-xs text-slate-500 tabular-nums">
                    <span>{c.nombre} · {c.detalle}</span>
                    <span>{fmt(c.monto)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 space-y-1 text-xs">
              {os.some((o) => o.sin_costo) && (
                <p className="text-amber-300">⚠️ Hay productos sin costo cargado. <Link href="/rentabilidad-meli/costos" className="underline">Cargar costos</Link></p>
              )}
              {os.some((o) => o.flex_estimado) && <p className="text-amber-300">📍 El cordón del Flex se estimó por el código postal más cercano.</p>}
              {primera.anulada > 0 && <p className="text-rose-300">Cancelada después de despachar: no hay venta, pero quedan el envío y la devolución.</p>}
            </div>

            <a href={`https://www.mercadolibre.com.ar/ventas/${primera.order_id}/detalle`} target="_blank" rel="noreferrer"
              className="mt-4 inline-block text-sm text-emerald-400 hover:text-emerald-300">Ver la venta en Mercado Libre ↗</a>
          </>
        )}
      </div>
    </div>
  );
}

export default function Ventas({ ventas }: { ventas: VentaFila[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [problema, setProblema] = useState<Problema | null>(null);
  const [porPagina, setPorPagina] = useState(10);
  const [pagina, setPagina] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);

  const q = busqueda.replace(/\D/g, '');
  const visibles = useMemo(
    () =>
      ventas.filter(
        (v) =>
          (!q || v.order_id.includes(q) || v.pack_id.includes(q)) &&
          (!problema || PROBLEMAS[problema].es(v)),
      ),
    [ventas, q, problema],
  );
  const paginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const pag = Math.min(pagina, paginas - 1);

  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Últimas ventas</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {(Object.keys(PROBLEMAS) as Problema[]).map((k) => {
          const n = ventas.filter(PROBLEMAS[k].es).length;
          if (!n) return null;
          return (
            <button key={k} onClick={() => { setProblema((p) => (p === k ? null : k)); setPagina(0); }}
              className={`rounded-lg border px-2.5 py-1 text-xs ${problema === k ? 'border-emerald-600 bg-emerald-600/15 text-emerald-200' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`}>
              {PROBLEMAS[k].label} <span className="font-semibold tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>
      <form className="flex items-center gap-2 flex-wrap mb-3"
        onSubmit={(e) => { e.preventDefault(); if (q && !visibles.length) setAbierta(q); }}>
        <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0); }} inputMode="numeric"
          placeholder="Buscar por número de venta…" aria-label="Buscar por número de venta"
          className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600 flex-1 min-w-[12rem] max-w-sm" />
        {q.length >= 10 && !visibles.length && (
          <button type="submit" className="rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-sm text-white">Buscar en todo el historial</button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{visibles.length.toLocaleString('es-AR')} ventas</span>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 font-medium">Venta</th>
              <th className="py-2 pl-3 font-medium hidden md:table-cell">Publicación</th>
              <th className="py-2 pl-3 font-medium hidden sm:table-cell">Estado</th>
              <th className="py-2 pl-3 font-medium hidden sm:table-cell">Fecha</th>
              <th className="py-2 pl-3 font-medium text-right">Venta</th>
              <th className="py-2 pl-3 font-medium text-right">Neto</th>
              <th className="py-2 pl-3 font-medium text-right hidden sm:table-cell">%</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(pag * porPagina, (pag + 1) * porPagina).map((v) => (
              <tr key={v.order_id} onClick={() => setAbierta(v.pack_id || v.order_id)}
                className="border-t border-slate-800/60 tabular-nums cursor-pointer hover:bg-slate-800/40">
                <td className="py-2 pr-2">
                  <button className="text-left hover:text-emerald-300 font-medium" onClick={(e) => { e.stopPropagation(); setAbierta(v.pack_id || v.order_id); }}>
                    {numero(v)}
                  </button>
                  <span className="block sm:hidden text-[11px] text-slate-500">{cuando(v)}</span>
                  {Object.values(PROBLEMAS).some((p) => p.es(v)) && (
                    <span className="block text-[11px] text-amber-300">{(Object.keys(PROBLEMAS) as Problema[]).filter((k) => PROBLEMAS[k].es(v)).map((k) => PROBLEMAS[k].label).join(' · ')}</span>
                  )}
                </td>
                <td className="py-2 pl-3 hidden md:table-cell max-w-[16rem]">
                  <div className="flex items-center gap-2 min-w-0">
                    {v.foto && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.foto} alt="" loading="lazy" className="w-7 h-7 rounded-md object-cover bg-white shrink-0" />
                    )}
                    <span className="truncate text-slate-300" title={v.titulo}>{v.titulo}</span>
                  </div>
                </td>
                <td className="py-2 pl-3 hidden sm:table-cell"><Estado v={v} /></td>
                <td className="py-2 pl-3 hidden sm:table-cell whitespace-nowrap text-slate-300">{cuando(v)}</td>
                <td className="py-2 pl-3 text-right">{fmtCorto(v.venta)}</td>
                <td className={`py-2 pl-3 text-right ${v.neto < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmtCorto(v.neto)}</td>
                <td className="py-2 pl-3 text-right text-slate-400 hidden sm:table-cell">{pct(v.neto, v.venta)}</td>
              </tr>
            ))}
            {!visibles.length && (
              <tr><td colSpan={7} className="py-4 text-sm text-slate-500">
                {q ? 'No está en este período. Si el número está completo, buscalo en todo el historial.' : 'No hay ventas con ese filtro.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {visibles.length > porPagina && (
        <div className="flex items-center justify-between gap-3 mt-3 flex-wrap text-sm">
          <label className="text-xs text-slate-400 flex items-center gap-2">
            Filas
            <select value={porPagina} onChange={(e) => { setPorPagina(Number(e.target.value)); setPagina(0); }}
              className="rounded-lg bg-slate-950 border border-slate-800 px-2 py-1 text-slate-200">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button onClick={() => setPagina(pag - 1)} disabled={pag === 0} className="rounded-lg border border-slate-800 px-2.5 py-1 disabled:opacity-40 hover:border-slate-600">‹</button>
            <span className="text-xs text-slate-400 tabular-nums">Página {pag + 1} de {paginas}</span>
            <button onClick={() => setPagina(pag + 1)} disabled={pag >= paginas - 1} className="rounded-lg border border-slate-800 px-2.5 py-1 disabled:opacity-40 hover:border-slate-600">›</button>
          </div>
        </div>
      )}

      {abierta && <DetalleVenta id={abierta} onCerrar={() => setAbierta(null)} />}
    </section>
  );
}
