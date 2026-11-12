'use client';

import { useEffect, useState } from 'react';
import AppHeader from './AppHeader';

// Página de rentabilidad VARIABLE de Local y Mayorista (lee /api/rentabilidad/canal). Cascada desde la venta neta
// hasta la ganancia, y la lista de pedidos con su ganancia. Sin costos fijos (van a la cuenta general de la empresa).
type Linea = { clave: string; nombre: string; monto: number; nota?: string };
type Orden = { id: string; fecha: string; detalle: string; venta: number; costo: number; ganancia: number; sinCosto: boolean };
type Data = { desde: string; hasta: string; lineas: Linea[]; ordenes: Orden[]; ganancia: number; margen: number | null; pedidos: number; sinCosto: number; ventaBruta: number; nota: string };

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' }, { id: 'ayer', label: 'Ayer' }, { id: 'semana', label: '7 días' }, { id: 'mes', label: 'Mes' }, { id: 'mesant', label: 'Mes anterior' },
] as const;
const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');
const pct = (n: number | null) => (n == null ? '–' : `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`);
const caja = 'bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5';
const fecha = (f: string) => { const [d, h] = f.split(' '); return `${d.slice(8, 10)}/${d.slice(5, 7)}${h ? ` ${h}` : ''}`; };

export default function RentabilidadCanal({ canal, titulo }: { canal: 'local' | 'mayorista'; titulo: string }) {
  const [periodo, setPeriodo] = useState<string>('mes');
  const [s, setS] = useState<{ p: string; data?: Data; err?: string } | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch(`/api/rentabilidad/canal?canal=${canal}&periodo=${periodo}`)
      .then((r) => r.json())
      .then((d) => vivo && setS(d.error ? { p: periodo, err: d.error } : { p: periodo, data: d }))
      .catch((e) => vivo && setS({ p: periodo, err: String(e) }));
    return () => { vivo = false; };
  }, [canal, periodo]);
  const d = s?.p === periodo ? s.data : undefined;
  const err = s?.p === periodo ? s.err : undefined;
  const venta = d?.lineas[0]?.monto ?? 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title={titulo} subtitle="Rentabilidad variable · neto de IVA · sin costos fijos" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 w-fit text-sm overflow-x-auto max-w-full">
          {PERIODOS.map((p) => (
            <button key={p.id} onClick={() => setPeriodo(p.id)}
              className={`px-3 py-1.5 rounded-md whitespace-nowrap ${periodo === p.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
              {p.label}
            </button>
          ))}
        </div>
        {err && <div className={`${caja} text-rose-300 text-sm`}>Error: {err}</div>}
        {!d && !err && <div className={`${caja} text-slate-400 text-sm`}>Cargando…</div>}
        {d && (
          <>
            {d.nota && <div className="text-xs text-amber-300/90">{d.nota}</div>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Pedidos', d.pedidos.toLocaleString('es-AR'), d.sinCosto ? `${d.sinCosto} sin costo cargado` : ''],
                ['Venta neta', fmt(venta), `cobrado ${fmt(d.ventaBruta)}`],
                ['Ganancia', fmt(d.ganancia), 'variable, antes de costos fijos'],
                ['Margen', pct(d.margen), 'ganancia ÷ venta neta'],
              ].map(([t, v, n]) => (
                <div key={t} className={caja}>
                  <div className="text-xs text-slate-500">{t}</div>
                  <div className={`text-xl font-semibold mt-1 ${t === 'Ganancia' && d.ganancia < 0 ? 'text-rose-400' : t === 'Ganancia' ? 'text-emerald-300' : ''}`}>{v}</div>
                  {n && <div className={`text-xs mt-1 ${t === 'Pedidos' ? 'text-amber-300' : 'text-slate-500'}`}>{n}</div>}
                </div>
              ))}
            </div>
            <div className={caja}>
              <h2 className="text-sm font-semibold mb-3">De la venta a la ganancia</h2>
              <table className="w-full text-sm">
                <tbody>
                  {d.lineas.filter((l, i) => i === 0 || Math.round(l.monto) !== 0).map((l) => (
                    <tr key={l.clave} className="border-t border-slate-800 first:border-0">
                      <td className="py-2 pr-2">{l.nombre}{l.nota && <div className="text-xs text-slate-500">{l.nota}</div>}</td>
                      <td className={`py-2 text-right tabular-nums ${l.monto < 0 ? 'text-slate-300' : ''}`}>{fmt(l.monto)}</td>
                      <td className="py-2 pl-3 text-right text-xs text-slate-500 w-16">{venta ? pct(l.monto / venta) : ''}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-700 font-semibold">
                    <td className="py-2">Ganancia<div className="text-xs font-normal text-slate-500">variable: los costos fijos van a la cuenta general</div></td>
                    <td className={`py-2 text-right tabular-nums ${d.ganancia < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(d.ganancia)}</td>
                    <td className="py-2 pl-3 text-right text-xs text-slate-400">{pct(d.margen)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className={caja}>
              <h2 className="text-sm font-semibold mb-3">Pedidos</h2>
              {!d.ordenes.length ? <div className="text-sm text-slate-500">Sin pedidos en el período.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-500 text-left">
                      <th className="pb-2 font-normal">Pedido</th><th className="pb-2 font-normal text-right">Venta</th>
                      <th className="pb-2 font-normal text-right hidden sm:table-cell">Costo</th><th className="pb-2 font-normal text-right">Ganancia</th>
                    </tr></thead>
                    <tbody>
                      {d.ordenes.map((o) => (
                        <tr key={o.id} className="border-t border-slate-800">
                          <td className="py-1.5 pr-2">{o.id} <span className="text-xs text-slate-500">{fecha(o.fecha)}</span>
                            {(o.detalle || o.sinCosto) && <div className="text-xs text-slate-500">{o.detalle}{o.sinCosto && <span className="text-amber-300">{o.detalle ? ' · ' : ''}sin costo</span>}</div>}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmt(o.venta)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400 hidden sm:table-cell">{fmt(o.costo)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${o.ganancia < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(o.ganancia)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
