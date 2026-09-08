'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Bucket = { qty: number; revenue: number };
type ProductRow = { id: string; title: string; day: Bucket; week: Bucket; month: Bucket; last30: Bucket };

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

export default function Productos() {
  const [data, setData] = useState<{ generated_at: string; products: ProductRow[] } | null>(null);
  const [err, setErr] = useState('');

  async function load() {
    setErr('');
    try {
      const r = await fetch('/api/ml/productos', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
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

      <main className="max-w-7xl mx-auto px-6 py-6">
        {err && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{err}</div>}
        {!data && <div className="text-slate-500">Cargando productos…</div>}
        {data && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Producto</th>
                  <th className="text-right px-3">Hoy Unid</th>
                  <th className="text-right px-3">Hoy $</th>
                  <th className="text-right px-3">Semana Unid</th>
                  <th className="text-right px-3">Semana $</th>
                  <th className="text-right px-3">Mes Unid</th>
                  <th className="text-right px-3">Mes $</th>
                  <th className="text-right px-3">30d Unid</th>
                  <th className="text-right px-4">30d $</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2 px-4 max-w-[280px] truncate" title={p.title}>{p.title}</td>
                    <td className="text-right px-3 tabular-nums">{p.day.qty}</td>
                    <td className="text-right px-3 tabular-nums">{fmt(p.day.revenue)}</td>
                    <td className="text-right px-3 tabular-nums">{p.week.qty}</td>
                    <td className="text-right px-3 tabular-nums">{fmt(p.week.revenue)}</td>
                    <td className="text-right px-3 tabular-nums">{p.month.qty}</td>
                    <td className="text-right px-3 tabular-nums">{fmt(p.month.revenue)}</td>
                    <td className="text-right px-3 tabular-nums">{p.last30.qty}</td>
                    <td className="text-right px-4 tabular-nums">{fmt(p.last30.revenue)}</td>
                  </tr>
                ))}
                {data.products.length === 0 && (
                  <tr><td colSpan={9} className="py-8 text-center text-slate-500">Sin ventas en los últimos 30 días</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
