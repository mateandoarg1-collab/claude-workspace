'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type ProductRow = { id: string; title: string; qty: number; revenue: number };
type Data = { generated_at: string; range: string; from: string; to: string; products: ProductRow[] };

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

const RANGES: Array<{ key: string; label: string }> = [
  { key: 'today', label: 'Hoy' },
  { key: '7d', label: 'Últimos 7 días' },
  { key: '15d', label: 'Últimos 15 días' },
  { key: '30d', label: 'Últimos 30 días' },
  { key: 'month', label: 'Mes actual' },
  { key: 'prev_month', label: 'Mes anterior' },
  { key: 'year', label: 'Año actual' },
];

function fmtDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export default function Productos() {
  const [range, setRange] = useState('month');
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  async function load(r: string) {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/ml/productos?range=${r}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? '';

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🧉 MATEANDO — Productos</h1>
            <p className="text-xs text-slate-500">
              {data ? `Actualizado ${new Date(data.generated_at).toLocaleTimeString('es-AR')}` : 'Cargando…'}
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-slate-600 hover:text-slate-900">Ventas</Link>
            <Link href="/productos" className="font-medium text-emerald-700">Productos</Link>
            <Link href="/preguntas" className="text-slate-600 hover:text-slate-900">Preguntas</Link>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); location.href = '/login'; }}
              className="text-slate-500 hover:text-red-600"
            >Salir</button>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value)}
            className="bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-full appearance-none cursor-pointer pr-8"
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='white'><path d='M5.5 7.5l4.5 4.5 4.5-4.5' stroke='white' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.75rem center',
            }}
          >
            {RANGES.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          {data && (
            <span className="text-sm text-slate-500">
              {fmtDateShort(data.from)} – {fmtDateShort(data.to)}
            </span>
          )}
        </div>

        {err && <div className="bg-red-50 text-red-700 p-3 rounded">{err}</div>}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex items-center justify-between">
          <span className="text-sm text-slate-500">Publicaciones con ventas</span>
          <span className="text-2xl font-bold text-blue-600 tabular-nums">{data?.products.length ?? '—'}</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {loading && <div className="p-6 text-slate-500">Cargando {rangeLabel.toLowerCase()}…</div>}
          {!loading && data && data.products.length === 0 && (
            <div className="p-8 text-center text-slate-500">Sin ventas en este período</div>
          )}
          {!loading && data && data.products.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Producto</th>
                  <th className="text-right px-3">Unid</th>
                  <th className="text-right px-4">Facturado</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2.5 px-4 max-w-[240px] truncate" title={p.title}>{p.title}</td>
                    <td className="text-right px-3 tabular-nums">{p.qty}</td>
                    <td className="text-right px-4 tabular-nums font-medium">{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
