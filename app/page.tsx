'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Sum = { orders: number; amount: number; units: number; cancelled?: number; elapsed_hours?: number };
type SalesData = {
  generated_at: string;
  today: Sum;
  yesterday_same_hour: Sum;
  yesterday_full: Sum;
  last_7_days: Sum;
  month_to_date: Sum;
  top_products_today: Array<{ title: string; qty: number; revenue: number; id: string }>;
};

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const pct = (a: number, b: number) => {
  if (!b) return '—';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
};
const tone = (a: number, b: number) =>
  !b ? 'text-slate-500' : a >= b ? 'text-emerald-600' : 'text-red-600';

export default function Dashboard() {
  const [data, setData] = useState<SalesData | null>(null);
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    setErr('');
    try {
      const r = await fetch('/api/ml/sales', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  if (err) {
    return (
      <div className="p-8 text-red-600">
        Error: {err}
        <button onClick={load} className="ml-2 underline">reintentar</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Cargando datos de Mercado Libre…
      </div>
    );
  }

  const t = data.today;
  const y = data.yesterday_same_hour;
  const yf = data.yesterday_full;
  const w = data.last_7_days;
  const m = data.month_to_date;

  const projAmt = t.elapsed_hours ? (t.amount / t.elapsed_hours) * 24 : 0;
  const projN = t.elapsed_hours ? (t.orders / t.elapsed_hours) * 24 : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🧉 MATEANDO — Panel</h1>
            <p className="text-xs text-slate-500">
              Última actualización: {new Date(data.generated_at).toLocaleTimeString('es-AR')}
              {refreshing ? ' · refrescando…' : ''}
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="font-medium text-emerald-700">Mercado Libre</Link>
            <Link href="/canales" className="text-slate-600 hover:text-slate-900">Canales</Link>
            <Link href="/resumen" className="text-slate-600 hover:text-slate-900">Resumen 📱</Link>
            <Link href="/preguntas" className="text-slate-600 hover:text-slate-900">Preguntas</Link>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); location.href = '/login'; }}
              className="text-slate-500 hover:text-red-600"
            >Salir</button>
          </nav>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Hoy ({t.elapsed_hours?.toFixed(1)}hs transcurridas)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Órdenes" value={t.orders} sub={`Ayer a esta hora: ${y.orders}`} change={pct(t.orders, y.orders)} tone={tone(t.orders, y.orders)} />
            <Stat label="Facturación" value={fmt(t.amount)} sub={`Ayer: ${fmt(y.amount)}`} change={pct(t.amount, y.amount)} tone={tone(t.amount, y.amount)} />
            <Stat label="Unidades" value={t.units} sub={`Canceladas hoy: ${t.cancelled ?? 0}`} />
            <Stat label="Proyección día" value={fmt(projAmt)} sub={`~${projN.toFixed(0)} órdenes · ayer total ${fmt(yf.amount)}`} change={pct(projAmt, yf.amount)} tone={tone(projAmt, yf.amount)} />
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Comparativos</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card title="Últimos 7 días" lines={[
              ['Órdenes', w.orders.toString()],
              ['Facturación', fmt(w.amount)],
              ['Prom diario', fmt(w.amount / 7)],
            ]} />
            <Card title="Mes a la fecha" lines={[
              ['Órdenes', m.orders.toString()],
              ['Facturación', fmt(m.amount)],
              ['Ticket prom', m.orders ? fmt(m.amount / m.orders) : '$0'],
            ]} />
            <Card title="Ayer completo" lines={[
              ['Órdenes', yf.orders.toString()],
              ['Facturación', fmt(yf.amount)],
              ['Unidades', yf.units.toString()],
            ]} />
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Top productos de hoy</h2>
          {data.top_products_today.length === 0 ? (
            <p className="text-slate-500">Sin ventas todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500">
                <tr><th className="py-2">Producto</th><th className="text-right">Unid</th><th className="text-right">Facturado</th></tr>
              </thead>
              <tbody>
                {data.top_products_today.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100">
                    <td className="py-2 pr-2">{p.title}</td>
                    <td className="text-right tabular-nums">{p.qty}</td>
                    <td className="text-right tabular-nums">{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, sub, change, tone }: { label: string; value: string | number; sub?: string; change?: string; tone?: string }) {
  return (
    <div className="border border-slate-100 rounded-lg p-4 bg-slate-50/60">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {change && <div className={`text-xs font-medium ${tone}`}>{change}</div>}
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function Card({ title, lines }: { title: string; lines: Array<[string, string]> }) {
  return (
    <div className="border border-slate-100 rounded-lg p-4 bg-slate-50/60">
      <div className="text-sm font-semibold text-slate-700 mb-2">{title}</div>
      <dl className="text-sm space-y-1">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-slate-500">{k}</dt>
            <dd className="tabular-nums font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
