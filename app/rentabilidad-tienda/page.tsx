'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';
import { Tarjeta, nomDia, num, porc } from '../components/TarjetaKpi';

type Totales = {
  ventas: number; unidades: number; venta: number; descuentos: number; comision: number; envio_tienda: number;
  impuestos: number; deb_cred: number; costo: number; packaging: number; neto: number;
};
type Ind = { pauta: number; ganancia: number; margen: number | null; roas: number | null; cpa: number | null; tacos: number | null; ticket: number | null };
type Total = Totales & Ind & { meta: number; google: number; sinCosto: number; sinComision: number };
type Dia = Totales & Ind & { fecha: string };
type Producto = { id: string; nombre: string; foto: string | null; link: string | null; unidades: number; venta: number; costo: number; neto: number };
type Grupo = Totales & { nombre: string };
type Venta = {
  fecha: string; order_id: string; numero: string; canal: string; pago: string; envio: string; cp: string; provincia: string; ciudad: string;
  unidades: number; venta: number; descuentos: number; envio_cobrado: number; comision: number; envio_tienda: number; impuestos: number;
  costo: number; packaging: number; neto: number; sin_costo: number; sin_comision: number; cuotas: number | null; creada: string;
  deb_cred: number; facturada: boolean;
  productos: { id: string; n: string; v: string; q: number; p: number; foto: string | null }[];
};
type Data = {
  desde: string; hasta: string; actualizado: string; total: Total; anterior: (Total & { desde: string; hasta: string }) | null;
  serie: Dia[]; productos: Producto[]; pagos: Grupo[]; envios: Grupo[]; ventas: Venta[];
};

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: '7 días' },
  { id: 'mes', label: 'Mes' },
  { id: 'mesant', label: 'Mes anterior' },
] as const;
const CANALES = [
  { id: 'online', label: 'Tienda online' },
  { id: 'local', label: 'Local' },
  { id: 'todo', label: 'Todo' },
] as const;
const PAGO: Record<string, string> = {
  mercadopago: 'Mercado Pago', transferencia: 'Transferencia', gocuotas: 'GoCuotas', otro: 'Otro',
  'local-tarjeta': 'Local · Tarjeta (MP)', 'local-transferencia': 'Local · Transferencia', 'local-efectivo': 'Local · Efectivo',
  acordar: 'Local · sin medio anotado',
};

const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');
const fmt2 = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n: number, de: number) => (de ? `${((n / de) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '–');
const color = (n: number) => (n < 0 ? 'text-rose-400' : 'text-emerald-300');
const cuando = (v: { creada: string; fecha: string }) =>
  v.creada
    ? new Date(v.creada).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : nomDia(v.fecha);
const caja = 'bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5';

function TablaGrupo({ titulo, filas, nombre }: { titulo: string; filas: Grupo[]; nombre: (n: string) => string }) {
  return (
    <section className={caja}>
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{titulo}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 font-medium">{titulo.replace('Por ', '')}</th>
              <th className="text-right font-medium">Ventas</th>
              <th className="text-right pl-3 font-medium">Facturación</th>
              <th className="text-right pl-3 font-medium hidden sm:table-cell">Comisión</th>
              <th className="text-right pl-3 font-medium">Neto</th>
              <th className="text-right pl-3 font-medium">Margen</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nombre} className="border-t border-slate-800/60 tabular-nums">
                <td className="py-2 pr-2">{nombre(f.nombre)}</td>
                <td className="text-right">{f.ventas.toLocaleString('es-AR')}</td>
                <td className="text-right pl-3">{fmt(f.venta)}</td>
                <td className="text-right pl-3 text-slate-400 hidden sm:table-cell">{fmt(f.comision)} <span className="text-[11px]">({pct(f.comision, f.venta)})</span></td>
                <td className={`text-right pl-3 ${color(f.neto)}`}>{fmt(f.neto)}</td>
                <td className="text-right pl-3 text-slate-400">{pct(f.neto, f.venta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DetalleVenta({ v, onCerrar }: { v: Venta; onCerrar: () => void }) {
  useEffect(() => {
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [onCerrar]);
  const filas = [
    { nombre: `Comisión de cobro (${PAGO[v.pago] ?? v.pago}${v.cuotas && v.cuotas > 1 ? `, ${v.cuotas} cuotas` : ''})`, valor: -v.comision },
    { nombre: 'Envío gratis (lo paga la tienda)', valor: -v.envio_tienda },
    { nombre: v.facturada ? 'IIBB (5% de la venta sin IVA)' : 'IIBB (no se factura)', valor: -v.impuestos },
    { nombre: v.facturada ? 'Imp. débitos y créditos (1,2%)' : 'Imp. débitos y créditos (no se factura)', valor: -v.deb_cred },
    { nombre: 'Costo de productos', valor: -v.costo },
    { nombre: 'Packaging', valor: -v.packaging },
  ];
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" onClick={onCerrar} role="dialog" aria-label={`Venta ${v.numero}`}>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-4 sm:p-6 my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-50">Venta #{v.numero}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{v.canal === 'local' ? 'Local' : 'Tienda online'} · {PAGO[v.pago] ?? v.pago}</p>
          </div>
          <button onClick={onCerrar} className="text-slate-400 hover:text-slate-100 text-xl leading-none px-1" aria-label="Cerrar">×</button>
        </div>
        <div className="grid grid-cols-3 rounded-xl border border-slate-800 bg-slate-950/50 mt-4 divide-x divide-slate-800">
          {[['Venta neta', fmt2(v.venta)], ['Neto', fmt2(v.neto)], ['Margen neto', pct(v.neto, v.venta)]].map(([k, x]) => (
            <div key={k} className="p-3 min-w-0">
              <p className="text-[11px] text-slate-400">{k}</p>
              <p className="text-sm sm:text-base font-semibold tabular-nums mt-0.5 truncate text-slate-50">{x}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-xs text-slate-300">
          <span className="rounded-lg border border-slate-800 px-2 py-1">🗓 {cuando(v)}</span>
          {v.envio && <span className="rounded-lg border border-slate-800 px-2 py-1">🚚 {v.envio}</span>}
          {v.provincia && <span className="rounded-lg border border-slate-800 px-2 py-1">📍 {[v.ciudad, v.provincia].filter(Boolean).join(', ')}{v.cp && ` (${v.cp})`}</span>}
        </div>

        <h4 className="text-sm font-semibold text-slate-200 mt-5 mb-2">Productos</h4>
        <ul className="space-y-3">
          {v.productos.map((p, i) => (
            <li key={i} className="flex items-start gap-3">
              {p.foto ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.foto} alt="" className="w-11 h-11 rounded-lg object-cover bg-white border border-slate-800 shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-slate-950 border border-slate-800 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-100 truncate" title={p.n}>{p.n}</p>
                {p.v && <p className="text-[11px] text-slate-500 truncate">{p.v}</p>}
                <p className="text-xs text-slate-400 tabular-nums mt-0.5">{p.q} × {fmt2(p.p)} <span className="text-slate-600">(con IVA)</span></p>
              </div>
            </li>
          ))}
        </ul>

        <h4 className="text-sm font-semibold text-slate-200 mt-5 mb-1">Desglose</h4>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-t border-slate-800/60 font-semibold">
              <td className="py-2">
                {v.facturada ? 'Venta sin IVA' : 'Venta (no se factura, sin IVA a descontar)'}
                {v.descuentos > 0 && <span className="block text-[11px] font-normal text-slate-500">ya con {fmt2(v.descuentos)} de descuentos (cupón o pago)</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{fmt2(v.venta)}</td>
            </tr>
            {filas.map((f) => (
              <tr key={f.nombre} className="border-t border-slate-800/60">
                <td className="py-2 text-slate-300">{f.nombre}</td>
                <td className={`py-2 text-right tabular-nums ${f.valor < -0.005 ? 'text-rose-300' : 'text-slate-500'}`}>{fmt2(f.valor)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-700 font-semibold">
              <td className="py-2">Neto</td>
              <td className={`py-2 text-right tabular-nums ${color(v.neto)}`}>{fmt2(v.neto)}</td>
            </tr>
          </tbody>
        </table>
        {v.envio_cobrado > 0 && <p className="text-[11px] text-slate-500 mt-2">El comprador pagó {fmt2(v.envio_cobrado)} de envío (sin IVA), que va a OCA: no suma ni resta.</p>}
        <div className="mt-2 space-y-1 text-xs">
          {v.sin_costo > 0 && <p className="text-amber-300">⚠️ Hay productos sin costo o sin regla de costo: cuentan $0.</p>}
          {v.sin_comision > 0 && <p className="text-amber-300">⚠️ Falta la comisión de este medio de pago.</p>}
        </div>
        <a href={`https://panel.empretienda.com/listado-de-ventas/${v.order_id}`} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm text-emerald-400 hover:text-emerald-300">
          Ver la venta en Empretienda ↗
        </a>
      </div>
    </div>
  );
}

function Ventas({ ventas }: { ventas: Venta[] }) {
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'sinCosto' | 'sinComision' | null>(null);
  const [pagina, setPagina] = useState(0);
  const [abierta, setAbierta] = useState<Venta | null>(null);
  const q = busqueda.replace(/\D/g, '');
  const visibles = useMemo(
    () => ventas.filter((v) => (!q || v.numero.includes(q) || v.order_id.includes(q)) && (!filtro || (filtro === 'sinCosto' ? v.sin_costo > 0 : v.sin_comision > 0))),
    [ventas, q, filtro],
  );
  const porPagina = 25;
  const paginas = Math.max(1, Math.ceil(visibles.length / porPagina));
  const pag = Math.min(pagina, paginas - 1);
  const chips = [
    { id: 'sinCosto' as const, label: 'Sin costo de producto', n: ventas.filter((v) => v.sin_costo > 0).length },
    { id: 'sinComision' as const, label: 'Sin comisión de pago', n: ventas.filter((v) => v.sin_comision > 0).length },
  ];
  return (
    <section className={caja}>
      <h2 className="text-sm font-semibold text-slate-200 mb-3">Últimas ventas</h2>
      <div className="flex flex-wrap gap-2 mb-3">
        {chips.filter((c) => c.n).map((c) => (
          <button key={c.id} onClick={() => { setFiltro((f) => (f === c.id ? null : c.id)); setPagina(0); }}
            className={`rounded-lg border px-2.5 py-1 text-xs ${filtro === c.id ? 'border-emerald-600 bg-emerald-600/15 text-emerald-200' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`}>
            {c.label} <span className="font-semibold tabular-nums">{c.n}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input value={busqueda} onChange={(e) => { setBusqueda(e.target.value); setPagina(0); }} inputMode="numeric" placeholder="Buscar por número de venta…"
          aria-label="Buscar por número de venta"
          className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600 flex-1 min-w-[12rem] max-w-sm" />
        <span className="text-xs text-slate-500 ml-auto">{visibles.length.toLocaleString('es-AR')} ventas</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-400">
            <tr>
              <th className="py-2 font-medium">Venta</th>
              <th className="py-2 pl-3 font-medium hidden md:table-cell">Productos</th>
              <th className="py-2 pl-3 font-medium hidden sm:table-cell">Pago</th>
              <th className="py-2 pl-3 font-medium hidden sm:table-cell">Fecha</th>
              <th className="py-2 pl-3 font-medium text-right">Venta</th>
              <th className="py-2 pl-3 font-medium text-right">Neto</th>
              <th className="py-2 pl-3 font-medium text-right hidden sm:table-cell">%</th>
            </tr>
          </thead>
          <tbody>
            {visibles.slice(pag * porPagina, (pag + 1) * porPagina).map((v) => (
              <tr key={v.order_id} onClick={() => setAbierta(v)} className="border-t border-slate-800/60 tabular-nums cursor-pointer hover:bg-slate-800/40">
                <td className="py-2 pr-2">
                  <span className="font-medium hover:text-emerald-300">#{v.numero}</span>
                  <span className="block sm:hidden text-[11px] text-slate-500">{cuando(v)}</span>
                  {(v.sin_costo > 0 || v.sin_comision > 0) && (
                    <span className="block text-[11px] text-amber-300">{[v.sin_costo > 0 && 'sin costo', v.sin_comision > 0 && 'sin comisión'].filter(Boolean).join(' · ')}</span>
                  )}
                </td>
                <td className="py-2 pl-3 hidden md:table-cell max-w-[16rem]">
                  <div className="flex items-center gap-2 min-w-0">
                    {v.productos[0]?.foto && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.productos[0].foto} alt="" loading="lazy" className="w-7 h-7 rounded-md object-cover bg-white shrink-0" />
                    )}
                    <span className="truncate text-slate-300" title={v.productos.map((p) => p.n).join(' + ')}>
                      {v.productos[0]?.n}{v.productos.length > 1 && ` +${v.productos.length - 1}`}
                    </span>
                  </div>
                </td>
                <td className="py-2 pl-3 hidden sm:table-cell text-slate-300 whitespace-nowrap">{PAGO[v.pago] ?? v.pago}{v.cuotas && v.cuotas > 1 ? ` · ${v.cuotas}c` : ''}</td>
                <td className="py-2 pl-3 hidden sm:table-cell whitespace-nowrap text-slate-300">{cuando(v)}</td>
                <td className="py-2 pl-3 text-right">{fmt(v.venta)}</td>
                <td className={`py-2 pl-3 text-right ${color(v.neto)}`}>{fmt(v.neto)}</td>
                <td className="py-2 pl-3 text-right text-slate-400 hidden sm:table-cell">{pct(v.neto, v.venta)}</td>
              </tr>
            ))}
            {!visibles.length && <tr><td colSpan={7} className="py-4 text-sm text-slate-500">No hay ventas con ese filtro en el período.</td></tr>}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 mt-3 text-sm">
          <button onClick={() => setPagina(pag - 1)} disabled={pag === 0} className="rounded-lg border border-slate-800 px-2.5 py-1 disabled:opacity-40 hover:border-slate-600">‹</button>
          <span className="text-xs text-slate-400 tabular-nums">Página {pag + 1} de {paginas}</span>
          <button onClick={() => setPagina(pag + 1)} disabled={pag >= paginas - 1} className="rounded-lg border border-slate-800 px-2.5 py-1 disabled:opacity-40 hover:border-slate-600">›</button>
        </div>
      )}
      {abierta && <DetalleVenta v={abierta} onCerrar={() => setAbierta(null)} />}
    </section>
  );
}

export default function RentabilidadTienda() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('mes');
  const [canal, setCanal] = useState<(typeof CANALES)[number]['id']>('online');
  const [res, setRes] = useState<{ clave: string; data?: Data; err?: string } | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const clave = `${periodo}-${canal}`;

  useEffect(() => {
    let vivo = true;
    fetch(`/api/tienda/rentabilidad?periodo=${periodo}&canal=${canal}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { clave, err: d.error } : { clave, data: d }))
      .catch((e) => vivo && setRes({ clave, err: String(e) }));
    return () => { vivo = false; };
  }, [periodo, canal, clave]);

  const d = res?.clave === clave ? res.data : undefined;
  const err = res?.clave === clave ? res.err : '';
  const t = d?.total;
  const a = d?.anterior;
  const serie = (f: (x: Dia) => number | null) => (d?.serie ?? []).map((x) => ({ fecha: x.fecha, v: f(x) }));
  const conPauta = canal !== 'local';

  const cascada = t
    ? [
        { nombre: 'Venta neta', valor: t.venta, total: true, nota: `Sin IVA lo facturado (Mercado Pago, GoCuotas, tarjeta en el local y local sin medio anotado); transferencias y efectivo no se facturan y van enteros${t.descuentos ? `. Ya con ${fmt(t.descuentos)} de descuentos` : ''}` },
        { nombre: 'Comisión de cobro', valor: -t.comision, nota: 'Mercado Pago (con el costo de las cuotas sin interés), GoCuotas 7,9% + IVA, transferencias 3% de la financiera y tarjeta en el local (promedio de Point de los últimos 30 días)' },
        { nombre: 'Envíos gratis', valor: -t.envio_tienda, nota: 'Lo que cobra OCA cuando el envío corre por cuenta de la tienda' },
        { nombre: 'IIBB (5%)', valor: -t.impuestos, nota: 'Sobre la venta sin IVA de lo facturado' },
        { nombre: 'Imp. débitos y créditos (1,2%)', valor: -t.deb_cred, nota: 'Sobre lo cobrado facturado (con IVA y envío)' },
        { nombre: 'Costo de producto', valor: -t.costo },
        { nombre: 'Packaging', valor: -t.packaging, nota: 'Packaging de mates y caja de despacho (bolsa en el local)' },
        { nombre: 'Neto antes de publicidad', valor: t.neto, total: true },
        ...(conPauta ? [
          { nombre: 'Publicidad', valor: -t.pauta, nota: `Meta ${fmt(t.meta)} · Google ${fmt(t.google)}` },
          { nombre: 'Ganancia', valor: t.ganancia, total: true },
        ] : []),
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Rentabilidad Tienda" subtitle="Empretienda: margen por venta · neto de IVA lo facturado" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-900 overflow-x-auto max-w-full">
              {PERIODOS.map((p) => (
                <button key={p.id} onClick={() => setPeriodo(p.id)}
                  className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${periodo === p.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-900">
              {CANALES.map((c) => (
                <button key={c.id} onClick={() => setCanal(c.id)}
                  className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${canal === c.id ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          {d?.actualizado && (
            <span className="text-xs text-slate-500">
              Actualizado {new Date(d.actualizado).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>

        {err && <p className="text-sm text-rose-400">No se pudo leer la rentabilidad: {err}</p>}
        {!d && !err && <p className="text-sm text-slate-500">Cargando…</p>}

        {t && d && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tarjeta titulo="Ventas" valor={t.ventas.toLocaleString('es-AR')} actual={t.ventas} anterior={a?.ventas}
                detalle={`${t.unidades.toLocaleString('es-AR')} unidades · ticket ${t.ticket == null ? '–' : fmt(t.ticket)}`} puntos={serie((x) => x.ventas)} formato={(n) => n.toLocaleString('es-AR')} />
              <Tarjeta titulo="Facturación neta" valor={fmt(t.venta)} actual={t.venta} anterior={a?.venta} puntos={serie((x) => x.venta)} formato={fmt} />
              <Tarjeta titulo="Margen de ganancia" valor={t.margen == null ? '–' : porc(t.margen)} actual={t.margen} anterior={a?.margen} enPuntos
                puntos={serie((x) => x.margen)} formato={porc} />
              <Tarjeta titulo="Ganancia" valor={fmt(t.ganancia)} actual={t.ganancia} anterior={a?.ganancia}
                detalle={conPauta ? 'Después de publicidad' : 'El local no tiene publicidad asignada'} puntos={serie((x) => x.ganancia)} formato={fmt} />
              {conPauta && (
                <>
                  <Tarjeta titulo="Inversión publicitaria" valor={fmt(t.pauta)} actual={t.pauta} anterior={a?.pauta} mejorSiSube={false}
                    detalle={`Meta ${fmt(t.meta)} · Google ${fmt(t.google)}`} puntos={serie((x) => x.pauta)} formato={fmt} />
                  <Tarjeta titulo="ROAS" valor={t.roas == null ? '–' : `${num(t.roas)}x`} actual={t.roas} anterior={a?.roas}
                    detalle="Facturación ÷ inversión" puntos={serie((x) => x.roas)} formato={(n) => `${num(n)}x`} />
                  <Tarjeta titulo="Costo por venta" valor={t.cpa == null ? '–' : fmt(t.cpa)} actual={t.cpa} anterior={a?.cpa} mejorSiSube={false}
                    detalle="Inversión ÷ ventas" puntos={serie((x) => x.cpa)} formato={fmt} />
                  <Tarjeta titulo="TACOS" valor={t.tacos == null ? '–' : porc(t.tacos)} actual={t.tacos} anterior={a?.tacos} enPuntos mejorSiSube={false}
                    detalle="Inversión ÷ facturación" puntos={serie((x) => x.tacos)} formato={porc} />
                </>
              )}
            </div>
            <p className="text-[11px] text-slate-500 -mt-1">
              {conPauta ? 'La publicidad es Meta (MATEANDO2 +8% y MATEANDO 3 MP) y Google Ads, contra las ventas online. ' : ''}
              {d.anterior ? `Variación contra ${nomDia(d.anterior.desde)} – ${nomDia(d.anterior.hasta)}.` : 'Sin período anterior cargado para comparar.'}
            </p>

            {(t.sinCosto > 0 || t.sinComision > 0) && (
              <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 space-y-1">
                {t.sinCosto > 0 && <p>⚠️ {t.sinCosto} unidades sin costo (productos nuevos sin regla en scripts/cmv): cuentan $0.</p>}
                {t.sinComision > 0 && <p>⚠️ {t.sinComision} ventas de Mercado Pago sin el pago encontrado en MP: cuentan comisión $0.</p>}
              </div>
            )}

            <section className={caja}>
              <h2 className="text-sm font-semibold text-slate-200 mb-3">De la venta a la ganancia</h2>
              <table className="w-full text-sm">
                <tbody>
                  {cascada.map((c) => (
                    <tr key={c.nombre} className={`border-t border-slate-800/60 ${c.total ? 'font-semibold' : ''}`}>
                      <td className="py-2 pr-2">
                        {c.nombre}
                        {c.nota && <span className="block text-[11px] font-normal text-slate-500">{c.nota}</span>}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${c.total ? color(c.valor) : 'text-slate-300'}`}>{fmt(c.valor)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-slate-500 w-16">{pct(c.valor, t.venta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <TablaGrupo titulo="Por medio de pago" filas={d.pagos} nombre={(n) => PAGO[n] ?? n} />
            <TablaGrupo titulo="Por envío" filas={d.envios} nombre={(n) => n} />

            <section className={caja}>
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Por producto</h2>
              <p className="text-xs text-slate-500 mb-3">Costo y neto de cada venta repartidos entre sus productos según el precio. Neto antes de publicidad.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="py-2 font-medium">Producto</th>
                      <th className="text-right pl-3 font-medium">U.</th>
                      <th className="text-right pl-3 font-medium">Venta</th>
                      <th className="text-right pl-3 font-medium hidden sm:table-cell">Costo</th>
                      <th className="text-right pl-3 font-medium">Neto</th>
                      <th className="text-right pl-3 font-medium">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(verTodos ? d.productos : d.productos.slice(0, 25)).map((p) => (
                      <tr key={p.id} className="border-t border-slate-800/60 tabular-nums">
                        <td className="py-2 pr-2 max-w-[13rem] sm:max-w-md">
                          <div className="flex items-center gap-3 min-w-0">
                            {p.foto ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.foto} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover bg-white border border-slate-800 shrink-0" />
                            ) : (
                              <div className="w-9 h-9 shrink-0 rounded-lg bg-slate-950 border border-slate-800" />
                            )}
                            {p.link ? (
                              <a href={p.link} target="_blank" rel="noreferrer" className="truncate hover:text-emerald-300" title={p.nombre}>{p.nombre}</a>
                            ) : (
                              <span className="truncate" title={p.nombre}>{p.nombre}</span>
                            )}
                          </div>
                        </td>
                        <td className="text-right pl-3">{p.unidades}</td>
                        <td className="text-right pl-3">{fmt(p.venta)}</td>
                        <td className="text-right pl-3 text-slate-400 hidden sm:table-cell">{fmt(p.costo)}</td>
                        <td className={`text-right pl-3 ${color(p.neto)}`}>{fmt(p.neto)}</td>
                        <td className="text-right pl-3 text-slate-400">{pct(p.neto, p.venta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.productos.length > 25 && (
                <button onClick={() => setVerTodos((x) => !x)} className="mt-3 text-sm text-emerald-400 hover:text-emerald-300">
                  {verTodos ? 'Ver menos' : `Ver los ${d.productos.length} productos`}
                </button>
              )}
            </section>

            <Ventas key={clave} ventas={d.ventas} />
          </>
        )}
      </main>
    </div>
  );
}
