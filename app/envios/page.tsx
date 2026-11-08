'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';
import type { Etapa, OrdenEnvio } from '@/lib/envios';

const ETAPAS: Record<Etapa, { label: string; color: string }> = {
  problema: { label: 'Problema', color: 'bg-red-500/15 text-red-300 border-red-500/40' },
  preparar: { label: 'Para preparar', color: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  etiqueta: { label: 'Etiqueta hecha', color: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40' },
  embalado: { label: 'Embalado', color: 'bg-lime-500/15 text-lime-300 border-lime-500/40' },
  retirado: { label: 'Retirado por OCA', color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40' },
  en_oca: { label: 'En OCA', color: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  en_viaje: { label: 'En viaje', color: 'bg-sky-500/15 text-sky-300 border-sky-500/40' },
  en_destino: { label: 'En centro de destino', color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40' },
  en_reparto: { label: 'En reparto', color: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
  en_sucursal: { label: 'En sucursal para retirar', color: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/40' },
  entregado: { label: 'Entregado', color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' },
  express: { label: 'Express 24 hs', color: 'bg-orange-500/15 text-orange-300 border-orange-500/40' },
  retiro_local: { label: 'Retiro en local', color: 'bg-teal-500/15 text-teal-300 border-teal-500/40' },
  acordar: { label: 'A acordar', color: 'bg-slate-500/15 text-slate-300 border-slate-500/40' },
  pago_pendiente: { label: 'Pago pendiente', color: 'bg-slate-500/15 text-slate-400 border-slate-600' },
};
const ORDEN: Etapa[] = ['problema', 'preparar', 'etiqueta', 'embalado', 'retirado', 'en_oca', 'en_viaje', 'en_destino', 'en_reparto', 'en_sucursal', 'entregado', 'express', 'retiro_local', 'acordar', 'pago_pendiente'];

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const cuando = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso.length <= 16 ? iso + ':00-03:00' : iso);
  return d.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
};

function Badge({ e }: { e: Etapa }) {
  return <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${ETAPAS[e].color}`}>{ETAPAS[e].label}</span>;
}

function Fila({ o }: { o: OrdenEnvio }) {
  const [abierta, setAbierta] = useState(false);
  return (
    <li className="border-b border-slate-800 last:border-0">
      <button onClick={() => setAbierta(!abierta)} className="w-full text-left px-4 py-3 hover:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
        <div className="sm:w-28 shrink-0">
          <div className="font-semibold tabular-nums">#{o.numero}</div>
          <div className="text-xs text-slate-400">{cuando(o.fecha)}</div>
        </div>
        <div className="sm:w-48 shrink-0"><Badge e={o.etapa} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-sm text-slate-200 truncate">{o.detalle}</div>
          <div className="text-xs text-slate-400 truncate">
            {o.desde && <>desde {cuando(o.desde)} · </>}
            {o.ciudad}{o.provincia && `, ${o.provincia}`} · {o.envio}
          </div>
          {o.alerta && <div className="text-xs text-red-300 mt-0.5">⚠ {o.alerta}</div>}
        </div>
        <div className="text-sm tabular-nums text-slate-300 sm:w-24 sm:text-right">{fmt(o.total)}</div>
      </button>
      {abierta && (
        <div className="px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">Productos</div>
            <ul className="space-y-0.5 text-slate-300">{o.productos.map((p, i) => <li key={i}>{p}</li>)}</ul>
          </div>
          <div>
            {o.paquetes.length === 0 && <div className="text-slate-400">Sin envío de OCA asociado.</div>}
            {o.paquetes.map((p) => (
              <div key={p.numero} className="mb-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
                  OCA <span className="select-all tabular-nums normal-case text-slate-300">{p.numero}</span>
                </div>
                {p.embalado && <div className="text-lime-300 text-xs mb-1">📦 Embalado{p.embalado.quien && ` por ${p.embalado.quien}`} · {cuando(p.embalado.fecha)}</div>}
                {p.eventos.length === 0 ? (
                  <div className="text-slate-400">Etiqueta hecha, OCA todavía no la retiró.</div>
                ) : (
                  <ol className="border-l border-slate-700 ml-1 space-y-1.5">
                    {[...p.eventos].reverse().map((ev, i) => (
                      <li key={i} className="pl-3 relative">
                        <span className={`absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ${i === 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        <div className={i === 0 ? 'text-slate-100' : 'text-slate-400'}>
                          {ev.estado}{ev.motivo && !/sin motivo/i.test(ev.motivo) && <span className="text-red-300"> ({ev.motivo})</span>}
                        </div>
                        <div className="text-xs text-slate-500">{cuando(ev.fecha)}{ev.sucursal && ` · ${ev.sucursal}`}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export default function Envios() {
  const [data, setData] = useState<{ ordenes: OrdenEnvio[]; actualizado: string } | null>(null);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<Etapa | 'todas' | 'alertas'>('todas');
  const [q, setQ] = useState('');

  useEffect(() => {
    fetch('/api/envios').then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setData(d))).catch((e) => setError(String(e)));
  }, []);

  const cuenta = useMemo(() => {
    const c: Partial<Record<Etapa, number>> = {};
    for (const o of data?.ordenes ?? []) c[o.etapa] = (c[o.etapa] ?? 0) + 1;
    return c;
  }, [data]);
  const alertas = data?.ordenes.filter((o) => o.alerta).length ?? 0;

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (data?.ordenes ?? [])
      .filter((o) => (filtro === 'todas' ? true : filtro === 'alertas' ? !!o.alerta : o.etapa === filtro))
      .filter((o) => !t || o.numero.includes(t) || o.ciudad.toLowerCase().includes(t) || o.paquetes.some((p) => p.numero.includes(t)))
      .sort((a, b) => (!!b.alerta as unknown as number) - (!!a.alerta as unknown as number) || ORDEN.indexOf(a.etapa) - ORDEN.indexOf(b.etapa) || b.fecha.localeCompare(a.fecha));
  }, [data, filtro, q]);

  const Chip = ({ id, label, n }: { id: typeof filtro; label: string; n: number }) => (
    <button
      onClick={() => setFiltro(id)}
      className={`rounded-full border px-3 py-1 text-sm whitespace-nowrap ${filtro === id ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200' : 'border-slate-700 text-slate-300 hover:border-slate-500'}`}
    >
      {label} <span className="tabular-nums text-slate-400">{n}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Envíos" subtitle={data ? `Tienda online · últimos 3 días · actualizado ${cuando(data.actualizado)}` : 'Tienda online · últimos 3 días'} width="7xl" />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {error && <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
        {!data && !error && <div className="text-slate-400">Cargando órdenes y seguimiento de OCA…</div>}
        {data && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <Chip id="todas" label="Todas" n={data.ordenes.length} />
              {alertas > 0 && <Chip id="alertas" label="⚠ Con alerta" n={alertas} />}
              {ORDEN.filter((e) => cuenta[e]).map((e) => <Chip key={e} id={e} label={ETAPAS[e].label} n={cuenta[e]!} />)}
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por N° de orden, N° de OCA o ciudad"
              className="w-full sm:w-96 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 focus:border-emerald-500 outline-none"
            />
            <ul className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
              {lista.map((o) => <Fila key={o.numero} o={o} />)}
              {!lista.length && <li className="p-4 text-slate-400">No hay órdenes en este estado.</li>}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
