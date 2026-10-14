'use client';

import { useEffect, useState } from 'react';
import AppHeader from './components/AppHeader';

type Sum = { orders: number; amount: number; units: number; cancelled?: number; elapsed_hours?: number; ads_cost?: number | null };
type SalesData = {
  generated_at: string;
  today: Sum;
  yesterday_same_hour: Sum;
  yesterday_full: Sum;
  last_7_days: Sum;
  month_to_date: Sum;
  top_products_today: Array<{ title: string; qty: number; revenue: number; id: string; thumbnail: string | null }>;
};

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const pct = (a: number, b: number) => {
  if (!b) return '—';
  const d = ((a - b) / b) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
};
const pctAbs = (a: number, b: number) => {
  if (!b) return '—';
  return Math.abs(((a - b) / b) * 100).toFixed(1) + '%';
};
const tone = (a: number, b: number) =>
  !b ? 'text-slate-400' : a >= b ? 'text-emerald-400' : 'text-red-400';
const arrow = (a: number, b: number) => (a >= b ? '↑' : '↓');
// Inversión en publicidad ML + qué % de la venta representa (TACOS).
const fmtAds = (s: Sum) =>
  s.ads_cost == null ? '—' : `${fmt(s.ads_cost)}${s.amount ? ` · ${((s.ads_cost / s.amount) * 100).toFixed(1)}%` : ''}`;
// ROAS = venta / inversión en ads.
const fmtRoas = (s: Sum) => (s.ads_cost ? (s.amount / s.ads_cost).toFixed(1) : '—');

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
      <div className="p-8 text-red-400">
        Error: {err}
        <button onClick={load} className="ml-2 underline">reintentar</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-400">
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
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Mercado Libre" subtitle={`Última actualización: ${new Date(data.generated_at).toLocaleTimeString('es-AR')}${refreshing ? ' · refrescando…' : ''}`} width="7xl" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="relative overflow-hidden rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-950 via-slate-900 to-slate-900 p-5 sm:p-7 shadow-2xl shadow-emerald-950/40">
          <div className="pointer-events-none absolute -top-24 -right-16 h-64 w-64 rounded-full bg-emerald-500/20 blur-3xl" />
          <div className="relative flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <h2 className="text-sm font-medium tracking-wide text-emerald-300">Ventas de hoy</h2>
              </div>
              <p className="text-xs text-slate-400 mt-1 tabular-nums">
                {new Date(data.generated_at).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
                {' · '}
                {new Date(data.generated_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <button
              onClick={load}
              aria-label="Actualizar"
              className={`w-10 h-10 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center justify-center text-lg text-slate-200 hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
            >
              ↻
            </button>
          </div>
          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8">
            <HeroMetric label="Pedidos concretados" value={t.orders.toLocaleString('es-AR')} prev={y.orders.toLocaleString('es-AR')} a={t.orders} b={y.orders} />
            <div className="min-w-0">
              <HeroMetric label="Ventas concretadas" value={fmt(t.amount)} prev={fmt(y.amount)} a={t.amount} b={y.amount} />
              <div className="mt-2 text-xs sm:text-sm text-slate-400 tabular-nums">
                Inversión ADS: <span className="text-amber-300 font-medium">{t.ads_cost == null ? '—' : fmt(t.ads_cost)}</span>
                {t.ads_cost != null && t.amount > 0 && <span> · {((t.ads_cost / t.amount) * 100).toFixed(1)}% de la venta</span>}
                {t.ads_cost ? <span> · ROAS <span className="text-amber-300 font-medium">{fmtRoas(t)}</span></span> : null}
              </div>
            </div>
          </div>
          <div className="relative mt-6">
            <div className="flex justify-between text-[11px] text-slate-400 mb-1.5 tabular-nums">
              <span>Día transcurrido {Math.round(((t.elapsed_hours ?? 0) / 24) * 100)}%</span>
              <span>Proyección {fmt(projAmt)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.min(100, ((t.elapsed_hours ?? 0) / 24) * 100)}%` }} />
            </div>
          </div>
        </section>

        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-4 text-slate-100">Hoy ({t.elapsed_hours?.toFixed(1)}hs transcurridas)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <Stat label="Unidades Concretadas" value={t.units} sub={`Canceladas hoy: ${t.cancelled ?? 0}`} />
            <Stat label="Proyección día" value={fmt(projAmt)} sub={`~${projN.toFixed(0)} órdenes · ayer total ${fmt(yf.amount)}`} change={pct(projAmt, yf.amount)} tone={tone(projAmt, yf.amount)} />
          </div>
        </section>

        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-4 text-slate-100">Comparativos</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
            <Card title="Últimos 7 días" lines={[
              ['Pedidos Concretados', w.orders.toString()],
              ['Ventas Concretadas', fmt(w.amount)],
              ['Prom diario', fmt(w.amount / 7)],
              ['Inversión ADS', fmtAds(w)],
              ['ROAS', fmtRoas(w)],
            ]} />
            <Card title="Mes a la fecha" lines={[
              ['Pedidos Concretados', m.orders.toString()],
              ['Ventas Concretadas', fmt(m.amount)],
              ['Ticket prom', m.orders ? fmt(m.amount / m.orders) : '$0'],
              ['Inversión ADS', fmtAds(m)],
              ['ROAS', fmtRoas(m)],
            ]} />
            <Card title="Ayer completo" lines={[
              ['Pedidos Concretados', yf.orders.toString()],
              ['Ventas Concretadas', fmt(yf.amount)],
              ['Unidades Concretadas', yf.units.toString()],
              ['Inversión ADS', fmtAds(yf)],
              ['ROAS', fmtRoas(yf)],
            ]} />
          </div>
        </section>

        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <h2 className="text-base sm:text-lg font-semibold mb-4 text-slate-100">Top productos concretados de hoy</h2>
          {data.top_products_today.length === 0 ? (
            <p className="text-slate-400">Sin ventas todavía.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-400">
                <tr><th className="py-2">Producto</th><th className="text-right">Unid</th><th className="text-right">Concretado</th></tr>
              </thead>
              <tbody>
                {data.top_products_today.map((p) => (
                  <tr key={p.id} className="border-t border-slate-900">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-3">
                        {p.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.thumbnail}
                            alt=""
                            className="w-9 h-9 rounded-lg object-cover flex-shrink-0 bg-slate-900 border border-slate-800"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-lg flex-shrink-0 bg-slate-900 border border-slate-800 flex items-center justify-center text-xs">
                            🧉
                          </div>
                        )}
                        <span>{p.title}</span>
                      </div>
                    </td>
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
    <div className="rounded-xl p-4 bg-slate-950/60 ring-1 ring-slate-800">
      <div className="text-[11px] text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-2xl font-semibold tabular-nums text-slate-50 mt-1">{value}</div>
      {change && <div className={`text-xs font-medium ${tone}`}>{change}</div>}
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

function Card({ title, lines }: { title: string; lines: Array<[string, string]> }) {
  return (
    <div className="rounded-xl p-4 bg-slate-950/60 ring-1 ring-slate-800">
      <div className="text-sm font-semibold text-emerald-300 mb-3">{title}</div>
      <dl className="text-sm space-y-2">
        {lines.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt className="text-slate-400">{k}</dt>
            <dd className="tabular-nums font-medium text-slate-100">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HeroMetric({ label, value, prev, a, b }: { label: string; value: string; prev: string; a: number; b: number }) {
  const up = a >= b;
  return (
    <div className="min-w-0">
      <div className="text-xs sm:text-sm text-slate-400">{label}</div>
      <div className="text-4xl lg:text-5xl font-semibold tracking-tight tabular-nums text-white mt-1 truncate">{value}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium tabular-nums ${
            !b ? 'bg-white/5 text-slate-400' : up ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'
          }`}
        >
          {b ? `${arrow(a, b)} ${pctAbs(a, b)}` : '—'}
        </span>
        <span className="text-slate-400 tabular-nums">Ayer a esta hora: {prev}</span>
      </div>
    </div>
  );
}
