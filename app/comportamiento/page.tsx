'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import type { ClarityInsights } from '@/lib/clarity';

function BarList({ items, valueKey, labelKey, fmt }: {
  items: Record<string, unknown>[];
  valueKey: string;
  labelKey: string;
  fmt?: (v: number) => string;
}) {
  const max = Math.max(1, ...items.map((i) => Number(i[valueKey])));
  return (
    <div className="space-y-2.5">
      {items.slice(0, 8).map((item, i) => {
        const value = Number(item[valueKey]);
        const label = String(item[labelKey]);
        const pct = (value / max) * 100;
        return (
          <div key={i}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-300 truncate pr-2">{label}</span>
              <span className="text-slate-500 tabular-nums shrink-0">{fmt ? fmt(value) : value}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-900">
              <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      {items.length === 0 && <p className="text-xs text-slate-500">Sin datos</p>}
    </div>
  );
}

function issueTone(pct: number): { color: string; bg: string; label: string } {
  if (pct === 0) return { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', label: 'OK' };
  if (pct < 10) return { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', label: 'Atención' };
  return { color: 'text-rose-400', bg: 'bg-rose-500/10 border-rose-500/30', label: 'Revisar' };
}

function IssueCard({ title, pct, count, hint }: { title: string; pct: number; count: number; hint: string }) {
  const tone = issueTone(pct);
  return (
    <div className={`rounded-xl border p-4 ${tone.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-slate-300">{title}</span>
        <span className={`text-[10px] font-semibold uppercase ${tone.color}`}>{tone.label}</span>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${tone.color}`}>{pct.toFixed(1)}%</p>
      <p className="text-xs text-slate-500 mt-0.5">{count} eventos · {hint}</p>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
    </div>
  );
}

function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

export default function Comportamiento() {
  const [days, setDays] = useState<1 | 2 | 3>(3);
  const [data, setData] = useState<ClarityInsights | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/clarity?days=${days}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : (setData(d), setErr(''))))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  const referrersByDomain = data
    ? Object.entries(
        data.referrers.reduce<Record<string, number>>((acc, r) => {
          const d = domainOf(r.name);
          acc[d] = (acc[d] ?? 0) + r.sessions;
          return acc;
        }, {})
      )
        .map(([name, sessions]) => ({ name, sessions }))
        .sort((a, b) => b.sessions - a.sessions)
    : [];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Comportamiento de usuarios" width="5xl" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">Datos de mateando.com vía Microsoft Clarity — agregados de sesiones reales.</p>
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
            {([1, 2, 3] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`text-xs px-3 py-1.5 rounded-md ${days === d ? 'bg-emerald-600 text-white' : 'text-slate-300 hover:bg-slate-950'}`}
              >
                {d === 1 ? 'Hoy' : `${d} días`}
              </button>
            ))}
          </div>
        </div>

        {err && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-sm text-rose-400">
            Error consultando Clarity: {err}
          </div>
        )}

        {loading && !data && <p className="text-sm text-slate-500">Cargando…</p>}

        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatTile label="Sesiones" value={data.traffic.sessions.toLocaleString('es-AR')} />
              <StatTile label="Usuarios únicos" value={data.traffic.users.toLocaleString('es-AR')} />
              <StatTile label="Páginas / sesión" value={data.traffic.pagesPerSession.toFixed(2)} />
              <StatTile label="Scroll promedio" value={`${data.engagement.avgScrollDepth.toFixed(0)}%`} />
            </section>

            <section>
              <h2 className="text-sm font-semibold text-slate-300 mb-3">Señales de fricción en la web</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <IssueCard title="Dead clicks" pct={data.issues.deadClick.pct} count={data.issues.deadClick.count} hint="clicks sin respuesta" />
                <IssueCard title="Rage clicks" pct={data.issues.rageClick.pct} count={data.issues.rageClick.count} hint="clicks repetidos con bronca" />
                <IssueCard title="Errores de script" pct={data.issues.scriptError.pct} count={data.issues.scriptError.count} hint="de las sesiones" />
                <IssueCard title="Quickback" pct={data.issues.quickback.pct} count={data.issues.quickback.count} hint="vuelven atrás rápido" />
              </div>
            </section>

            <div className="grid md:grid-cols-2 gap-6">
              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Páginas más visitadas</h2>
                <BarList items={data.pageTitles} valueKey="sessions" labelKey="name" />
              </section>

              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">De dónde viene el tráfico</h2>
                <BarList items={referrersByDomain} valueKey="sessions" labelKey="name" />
              </section>

              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Dispositivo</h2>
                <BarList items={data.devices} valueKey="sessions" labelKey="name" />
              </section>

              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
                <h2 className="text-sm font-semibold text-slate-300 mb-4">Sistema operativo</h2>
                <BarList items={data.os} valueKey="sessions" labelKey="name" />
              </section>
            </div>

            <p className="text-xs text-slate-500">
              Clarity solo expone métricas agregadas de los últimos 1-3 días vía API. Para ver grabaciones de sesión
              individuales o el mapa de calor en detalle, hay que entrar al dashboard de Clarity directamente.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
