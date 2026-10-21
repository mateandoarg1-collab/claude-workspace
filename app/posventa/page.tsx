'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import CanalMarca, { type CanalId } from '../components/CanalMarca';

type Fila = { nombre: string; reclamos: number; costo: number };
type Producto = { sku: string | null; nombre: string; reclamos: number; costo: number; vendidas: number; falla: number | null };
type Pendiente = { fecha: string | null; canal: string; orden: string; producto: string; motivo: string; responsable: string; abierto: number | null };
type Data = {
  mes: string;
  meses: { mes: string; reclamos: number; costo: number }[];
  resumen: { reclamos: number; costo: number; pendientes: number; diasProm: number | null; sinFecha: number };
  motivos: Fila[];
  responsables: Fila[];
  canales: Fila[];
  productos: Producto[];
  pendientes: Pendiente[];
  mesesConFalla: string[];
};

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nomMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const mesActual = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const CANAL: Record<string, string> = { online: 'Tienda Online', ml: 'Mercado Libre', local: 'Local', shopify: 'Shopify', mayorista: 'Mayorista', otro: 'Sin canal' };

function Tabla({ titulo, filas, total }: { titulo: string; filas: Fila[]; total: number }) {
  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{titulo}</h2>
      <ul className="space-y-2">
        {filas.slice(0, 8).map((f) => (
          <li key={f.nombre} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{f.nombre}</span>
              <span className="tabular-nums text-slate-400 shrink-0">{f.reclamos} · {fmt(f.costo)}</span>
            </div>
            <div className="h-1.5 rounded bg-slate-800 mt-1">
              <div className="h-1.5 rounded bg-emerald-600" style={{ width: `${total ? (f.reclamos / total) * 100 : 0}%` }} />
            </div>
          </li>
        ))}
        {!filas.length && <li className="text-sm text-slate-500">Sin reclamos</li>}
      </ul>
    </section>
  );
}

export default function Posventa() {
  const [mes, setMes] = useState(mesActual);
  const [res, setRes] = useState<{ mes: string; data?: Data; err?: string } | null>(null);
  const [verTodos, setVerTodos] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/posventa?mes=${mes}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { mes, err: d.error } : { mes, data: d }))
      .catch((e) => vivo && setRes({ mes, err: String(e) }));
    return () => { vivo = false; };
  }, [mes]);

  const d = res?.mes === mes ? res.data : undefined;
  const err = res?.mes === mes ? res.err : '';
  const maxMes = Math.max(1, ...(d?.meses ?? []).map((m) => m.reclamos));
  const conFalla = (d?.productos ?? []).filter((p) => p.falla != null).sort((a, b) => (b.falla ?? 0) - (a.falla ?? 0));
  const opciones = [...new Set([...(d?.meses ?? []).map((m) => m.mes), mesActual()])].sort().reverse();

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Posventa" subtitle="Reclamos de la planilla POSTVENTA - MAU" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <select value={mes} onChange={(e) => setMes(e.target.value)}
            className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-sm text-slate-200">
            {opciones.map((m) => <option key={m} value={m}>{nomMes(m)}</option>)}
            <option value="todo">Todo</option>
          </select>
          {err && <span className="text-sm text-red-400">{err}</span>}
          {!d && !err && <span className="text-sm text-slate-400">Cargando…</span>}
        </div>

        {d && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ['Reclamos', String(d.resumen.reclamos)],
                ['Costo', fmt(d.resumen.costo)],
                ['Pendientes (todos)', String(d.resumen.pendientes)],
                ['Días para resolver', d.resumen.diasProm == null ? '—' : d.resumen.diasProm.toFixed(1)],
              ].map(([t, v]) => (
                <div key={t} className="rounded-xl bg-slate-900 border border-slate-800 p-3">
                  <div className="text-xl font-bold tabular-nums">{v}</div>
                  <div className="text-xs text-slate-400">{t}</div>
                </div>
              ))}
            </div>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Reclamos por mes</h2>
              <div className="flex items-end gap-2 h-32">
                {d.meses.map((m) => (
                  <button key={m.mes} onClick={() => setMes(m.mes)} className="flex-1 h-full flex flex-col justify-end items-center gap-1" title={`${m.reclamos} reclamos · ${fmt(m.costo)}`}>
                    <span className="text-[11px] text-slate-400 tabular-nums">{m.reclamos}</span>
                    <div className={`w-full rounded-t ${m.mes === mes ? 'bg-emerald-400' : 'bg-emerald-700'}`} style={{ height: `${(m.reclamos / maxMes) * 100}%` }} />
                  </button>
                ))}
              </div>
              <div className="flex gap-2 mt-1">
                {d.meses.map((m) => <div key={m.mes} className="flex-1 text-center text-[11px] text-slate-500">{nomMes(m.mes)}<br />{fmt(m.costo / 1000)}k</div>)}
              </div>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200">% de falla por producto</h2>
              <p className="text-xs text-slate-500 mb-3">
                Reclamos de Tienda Online y Local ÷ unidades vendidas en Empretienda el mismo mes (los kits cuentan cada producto). Solo productos con 10 o más vendidas.
                {d.mesesConFalla.length ? ` Hay unidades desde ${nomMes(d.mesesConFalla[0])}.` : ''}
              </p>
              {conFalla.length ? (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr><th className="py-1">Producto</th><th className="text-right">Reclamos</th><th className="text-right pl-3">Vendidas</th><th className="text-right pl-3">% falla</th></tr>
                  </thead>
                  <tbody>
                    {conFalla.slice(0, verTodos ? undefined : 10).map((p) => (
                      <tr key={p.nombre} className="border-t border-slate-800">
                        <td className="py-2 pr-2">{p.nombre}</td>
                        <td className="text-right tabular-nums">{p.reclamos}</td>
                        <td className="text-right tabular-nums pl-3">{p.vendidas}</td>
                        <td className={`text-right tabular-nums pl-3 font-bold ${(p.falla ?? 0) >= 0.05 ? 'text-red-400' : (p.falla ?? 0) >= 0.02 ? 'text-amber-300' : 'text-emerald-300'}`}>
                          {((p.falla ?? 0) * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-slate-500">Todavía no hay unidades vendidas cargadas para este período.</p>
              )}
              {conFalla.length > 10 && (
                <button onClick={() => setVerTodos((v) => !v)} className="mt-2 text-xs text-sky-400">{verTodos ? 'Ver menos' : `Ver los ${conFalla.length}`}</button>
              )}
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Tabla titulo="Motivos" filas={d.motivos} total={d.resumen.reclamos} />
              <Tabla titulo="Productos con más reclamos" filas={d.productos.map((p) => ({ nombre: p.nombre, reclamos: p.reclamos, costo: p.costo }))} total={d.resumen.reclamos} />
              <Tabla titulo="Responsable" filas={d.responsables} total={d.resumen.reclamos} />
              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-200 mb-3">Canal</h2>
                <ul className="space-y-2">
                  {d.canales.map((c) => (
                    <li key={c.nombre} className="flex justify-between items-center text-sm">
                      {c.nombre in CANAL && c.nombre !== 'otro' ? <CanalMarca id={c.nombre as CanalId} /> : <span>{CANAL[c.nombre] ?? c.nombre}</span>}
                      <span className="tabular-nums text-slate-400">{c.reclamos} · {fmt(c.costo)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Pendientes ({d.pendientes.length})</h2>
              <ul className="divide-y divide-slate-800">
                {d.pendientes.map((p, i) => (
                  <li key={`${p.orden}-${i}`} className="py-2 text-sm flex justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate">{p.producto} <span className="text-slate-500">· {p.motivo}</span></div>
                      <div className="text-xs text-slate-500">{CANAL[p.canal] ?? p.canal} · orden {p.orden || '—'} · {p.responsable}</div>
                    </div>
                    <div className={`shrink-0 text-xs tabular-nums ${(p.abierto ?? 0) > 7 ? 'text-red-400' : 'text-slate-400'}`}>
                      {p.abierto == null ? 'sin fecha' : `hace ${p.abierto} d`}
                    </div>
                  </li>
                ))}
                {!d.pendientes.length && <li className="py-2 text-sm text-slate-500">No hay pendientes 🎉</li>}
              </ul>
            </section>

            {d.resumen.sinFecha > 0 && (
              <p className="text-xs text-slate-500">{d.resumen.sinFecha} reclamos tienen la fecha mal cargada en la planilla y no entran en los meses.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
