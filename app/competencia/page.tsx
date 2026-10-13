'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

type Row = {
  fecha: string;
  grupo: string;
  vendedor: string;
  item_id: string;
  precio: number;
  precio_original: number | null;
  disponible: number;
  titulo: string;
  permalink: string;
};

type ItemConfig = { vendedor: string; item_id: string; propio?: boolean };
type Grupo = { grupo: string; items: ItemConfig[] };

function latestByItem(history: Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const r of history) {
    const prev = map.get(r.item_id);
    if (!prev || r.fecha >= prev.fecha) map.set(r.item_id, r);
  }
  return map;
}

function historyForItem(history: Row[], item_id: string): Row[] {
  return history.filter((r) => r.item_id === item_id).sort((a, b) => a.fecha.localeCompare(b.fecha));
}

export default function Competencia() {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/competencia', { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGrupos(data.grupos);
      setHistory(data.history);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCheck() {
    setChecking(true);
    setError('');
    try {
      const res = await fetch('/api/competencia/check', { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setChecking(false);
  }

  const latest = latestByItem(history);

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Competencia" width="5xl" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Precios de publicaciones propias y de la competencia. Se revisa solo una vez por día; también podés forzar un chequeo ahora.
          </p>
          <button
            onClick={handleCheck}
            disabled={checking}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 shrink-0 ml-4"
          >
            {checking ? 'Revisando…' : 'Revisar ahora'}
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg p-3">{error}</div>
        )}

        {loading && <p className="text-sm text-slate-500">Cargando…</p>}

        {!loading && grupos.map((g) => {
          const propio = g.items.find((i) => i.propio);
          const propioPrecio = propio ? latest.get(propio.item_id)?.precio : undefined;

          return (
            <section key={g.grupo} className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">{g.grupo}</h2>
              <div className="-mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="text-left text-xs uppercase text-slate-400">
                  <tr>
                    <th className="py-2">Vendedor</th>
                    <th className="text-right">Precio</th>
                    <th className="text-right">vs. Mateando</th>
                    <th className="text-right">Stock</th>
                    <th className="text-right">Última actualización</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it) => {
                    const row = latest.get(it.item_id);
                    const delta =
                      propioPrecio && row && !it.propio
                        ? ((row.precio - propioPrecio) / propioPrecio) * 100
                        : null;
                    return (
                      <tr key={it.item_id} className="border-t border-slate-900">
                        <td className="py-3 font-medium">
                          {row?.permalink ? (
                            <a href={row.permalink} target="_blank" className="hover:underline">
                              {it.vendedor} {it.propio && '(propio)'}
                            </a>
                          ) : (
                            <>{it.vendedor} {it.propio && '(propio)'}</>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{row ? fmt(row.precio) : '—'}</td>
                        <td className="text-right tabular-nums">
                          {delta === null ? '—' : (
                            <span className={delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-slate-400'}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{row && row.disponible >= 0 ? row.disponible : '—'}</td>
                        <td className="text-right text-xs text-slate-500">{row?.fecha ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-900">
                <p className="text-xs text-slate-500 mb-2">Historial de precios</p>
                <div className="space-y-1">
                  {g.items.map((it) => {
                    const h = historyForItem(history, it.item_id);
                    if (h.length === 0) return null;
                    return (
                      <div key={it.item_id} className="text-xs text-slate-400 flex gap-2 flex-wrap">
                        <span className="font-medium w-24 shrink-0">{it.vendedor}:</span>
                        {h.map((r, i) => (
                          <span key={i} className="tabular-nums">
                            {r.fecha.slice(5)} {fmt(r.precio)}{i < h.length - 1 ? ' →' : ''}
                          </span>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}

        {!loading && grupos.length === 0 && (
          <p className="text-sm text-slate-500">No hay grupos configurados en data/competencia.json.</p>
        )}
      </main>
    </div>
  );
}
