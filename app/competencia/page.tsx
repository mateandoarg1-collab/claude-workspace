'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">🧉 MATEANDO — Competencia</h1>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-slate-600 hover:text-slate-900">Mercado Libre</Link>
            <Link href="/canales" className="text-slate-600 hover:text-slate-900">Canales</Link>
            <Link href="/competencia" className="font-medium text-emerald-700">Competencia</Link>
            <Link href="/resumen" className="text-slate-600 hover:text-slate-900">Resumen 📱</Link>
            <Link href="/preguntas" className="text-slate-600 hover:text-slate-900">Preguntas</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
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
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
        )}

        {loading && <p className="text-sm text-slate-400">Cargando…</p>}

        {!loading && grupos.map((g) => {
          const propio = g.items.find((i) => i.propio);
          const propioPrecio = propio ? latest.get(propio.item_id)?.precio : undefined;

          return (
            <section key={g.grupo} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold mb-4">{g.grupo}</h2>
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
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
                      <tr key={it.item_id} className="border-t border-slate-100">
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
                            <span className={delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-slate-500'}>
                              {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className="text-right tabular-nums">{row && row.disponible >= 0 ? row.disponible : '—'}</td>
                        <td className="text-right text-xs text-slate-400">{row?.fecha ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-400 mb-2">Historial de precios</p>
                <div className="space-y-1">
                  {g.items.map((it) => {
                    const h = historyForItem(history, it.item_id);
                    if (h.length === 0) return null;
                    return (
                      <div key={it.item_id} className="text-xs text-slate-500 flex gap-2 flex-wrap">
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
          <p className="text-sm text-slate-400">No hay grupos configurados en data/competencia.json.</p>
        )}
      </main>
    </div>
  );
}
