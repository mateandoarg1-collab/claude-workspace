'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';

type Row = {
  item_id: string;
  variation_id: number | null;
  title: string;
  variant: string;
  status: string;
  permalink: string;
  thumbnail: string;
  stock: number;
  no_disponible: number;
  vendidas: number;
  por_dia: number;
  dias_stock: number | null;
  china: boolean;
};

const COBERTURA = 45; // días objetivo para "Mandar", igual que el mail de las 9:00

function nivel(r: Row) {
  if (r.dias_stock === null) return { c: 'text-slate-400 bg-slate-800', t: 'Sin ventas', o: 4 };
  if (r.stock === 0) return { c: 'text-red-200 bg-red-900/70', t: 'Sin stock', o: 0 };
  if (r.dias_stock <= 10) return { c: 'text-red-300 bg-red-950', t: `${Math.floor(r.dias_stock)} días`, o: 1 };
  if (r.dias_stock <= 20) return { c: 'text-amber-300 bg-amber-950', t: `${Math.floor(r.dias_stock)} días`, o: 2 };
  return { c: 'text-emerald-300 bg-emerald-950', t: `${Math.floor(r.dias_stock)} días`, o: 3 };
}

function Item(r: Row) {
              const n = nivel(r);
              const mandar = Math.max(0, Math.ceil(r.por_dia * COBERTURA - r.stock));
              return (
                <li key={`${r.item_id}-${r.variation_id}`} className="flex gap-3 items-center rounded-lg bg-slate-900 border border-slate-800 p-2">
                  <a href={r.permalink} target="_blank" rel="noreferrer" className="shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={r.thumbnail} alt="" className="w-14 h-14 rounded bg-white object-contain" />
                  </a>
                  <div className="flex-1 min-w-0">
                    <a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-sky-400">{r.item_id}</a>
                    {r.status === 'paused' && <span className="ml-2 text-xs text-amber-400">pausada</span>}
                    <div className="text-sm truncate">{r.title}</div>
                    {r.variant && <div className="text-xs text-slate-300 font-semibold truncate">{r.variant}</div>}
                    <div className="text-xs text-slate-400">
                      vende {r.por_dia.toFixed(1)}/día{r.no_disponible > 0 && ` · ${r.no_disponible} no disp.`}
                      {mandar > 0 && <> · mandar <b className="text-slate-200">{mandar}</b></>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold">{r.stock}</div>
                    <div className={`text-xs rounded px-1.5 py-0.5 ${n.c}`}>{n.t}</div>
                  </div>
                </li>
              );
}

export default function Full() {
  const [rows, setRows] = useState<Row[]>([]);
  const [dias, setDias] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState<'alerta' | 'todo'>('alerta');
  const [busca, setBusca] = useState('');

  async function load(d: number) {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/ml/full?dias=${d}`, { cache: 'no-store' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setRows(data.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    Promise.resolve().then(() => load(dias));
  }, [dias]);

  const lista = useMemo(() => {
    const b = busca.toLowerCase();
    return rows
      .filter((r) => (filtro === 'todo' ? true : nivel(r).o <= 2))
      .filter((r) => !b || `${r.title} ${r.variant} ${r.item_id}`.toLowerCase().includes(b))
      .sort((a, z) => nivel(a).o - nivel(z).o || (a.dias_stock ?? 1e9) - (z.dias_stock ?? 1e9) || z.por_dia - a.por_dia);
  }, [rows, filtro, busca]);

  const chinos = useMemo(
    () => rows.filter((r) => r.china).sort((a, z) => nivel(a).o - nivel(z).o || (a.dias_stock ?? 1e9) - (z.dias_stock ?? 1e9)),
    [rows],
  );

  const cuenta = (o: number) => rows.filter((r) => nivel(r).o === o).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Stock Full" subtitle={`Días de stock en Full según ventas de los últimos ${dias} días`} />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          {[
            ['Sin stock', cuenta(0), 'text-red-300'],
            ['≤ 10 días', cuenta(1), 'text-red-400'],
            ['≤ 20 días', cuenta(2), 'text-amber-300'],
            ['OK', cuenta(3), 'text-emerald-300'],
          ].map(([t, n, c]) => (
            <div key={t as string} className="rounded-lg bg-slate-900 border border-slate-800 p-3">
              <div className={`text-2xl font-bold ${c}`}>{loading ? '…' : n}</div>
              <div className="text-xs text-slate-400">{t}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 items-center text-sm">
          {(['alerta', 'todo'] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`rounded-full px-3 py-1.5 ${filtro === f ? 'bg-emerald-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-300'}`}>
              {f === 'alerta' ? 'Para reponer' : 'Todo'}
            </button>
          ))}
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-full bg-slate-900 border border-slate-800 px-3 py-1.5 text-slate-300">
            {[7, 15, 30, 60].map((d) => <option key={d} value={d}>Tendencia {d} días</option>)}
          </select>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…"
            className="flex-1 min-w-[140px] rounded-full bg-slate-900 border border-slate-800 px-3 py-1.5 text-slate-200" />
          <button onClick={() => load(dias)} className="rounded-full px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300">↻</button>
        </div>

        {error && <div className="rounded bg-red-950 text-red-300 p-3 text-sm">{error}</div>}
        {loading && <div className="text-slate-400 text-sm">Cargando stock de Full… (tarda unos segundos)</div>}

        {!loading && chinos.length > 0 && (
          <section className="rounded-xl border border-emerald-800 bg-emerald-950/30 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-emerald-300">🇨🇳 Importados China en Full ({chinos.length})</h2>
            <ul className="space-y-2">{chinos.map(Item)}</ul>
          </section>
        )}

        {!loading && (
          <ul className="space-y-2">
            {lista.map(Item)}
            {!lista.length && <li className="text-slate-400 text-sm">Nada para reponer 🎉</li>}
          </ul>
        )}
      </main>
    </div>
  );
}
