'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import type { Periodo } from '@/lib/periodo';

type Embudo = { visitas: number; usuarios: number; nuevos: number; paginas: number; duracion: number; rebote: number; producto: number; checkout: number; compras: number };
type Data = {
  periodo: Periodo;
  desde: string;
  hasta: string;
  actual: Embudo;
  anterior: Embudo;
  empretienda: { ventas: number; monto: number; updatedAt: string } | null;
  diario: { dia: string; visitas: number; compras: number }[];
  canales: { nombre: string; visitas: number; compras: number }[];
  dispositivos: { nombre: string; visitas: number }[];
  productos: { path: string; titulo: string; vistas: number; visitas: number }[];
  regiones: { nombre: string; visitas: number }[];
};

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];
const VS: Record<Periodo, string> = { hoy: 'vs ayer', ayer: 'vs anteayer', semana: 'vs 7 días previos', mes: 'vs mismos días antes' };

const num = (n: number) => Math.round(n).toLocaleString('es-AR');
const pesos = (n: number) => '$' + num(n);
const pct = (n: number, d = 2) => (n * 100).toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';
const div = (a: number, b: number) => (b ? a / b : 0);
const durac = (s: number) => `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
const DISP: Record<string, string> = { mobile: 'Celular', desktop: 'Computadora', tablet: 'Tablet' };
const CANAL: Record<string, string> = {
  'Paid Social': 'Redes pagas (Meta)', 'Organic Social': 'Redes orgánicas', Direct: 'Directo', 'Organic Search': 'Google orgánico',
  'Paid Search': 'Google Ads', 'Cross-network': 'Google PMax', Referral: 'Otros sitios', Unassigned: 'Sin asignar', Email: 'Email',
  'AI Assistant': 'Asistentes IA', 'Organic Shopping': 'Google Shopping', 'Paid Other': 'Otros pagos', 'Mobile Push Notifications': 'Notificaciones push',
};

function Delta({ a, b, invertir }: { a: number; b: number; invertir?: boolean }) {
  if (!b) return <span className="text-xs text-slate-500">—</span>;
  const v = a / b - 1;
  const bien = invertir ? v < 0 : v > 0;
  return <span className={`text-xs tabular-nums ${Math.abs(v) < 0.005 ? 'text-slate-400' : bien ? 'text-emerald-400' : 'text-red-400'}`}>{v > 0 ? '▲' : '▼'} {pct(Math.abs(v), 0)}</span>;
}

function Kpi({ titulo, valor, a, b, invertir, nota }: { titulo: string; valor: string; a?: number; b?: number; invertir?: boolean; nota?: string }) {
  return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 p-3">
      <div className="text-xs text-slate-400">{titulo}</div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{valor}</div>
      {a != null && b != null ? <Delta a={a} b={b} invertir={invertir} /> : <span className="text-xs text-slate-500">{nota ?? ' '}</span>}
    </div>
  );
}

function Barras({ titulo, filas, extra }: { titulo: string; filas: { nombre: string; valor: number }[]; extra?: (i: number) => string }) {
  const tot = filas.reduce((s, f) => s + f.valor, 0);
  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{titulo}</h2>
      <ul className="space-y-2">
        {filas.slice(0, 8).map((f, i) => (
          <li key={f.nombre} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{f.nombre}</span>
              <span className="tabular-nums text-slate-400 shrink-0">{num(f.valor)} · {pct(div(f.valor, tot), 0)}{extra ? ` · ${extra(i)}` : ''}</span>
            </div>
            <div className="h-1.5 rounded bg-slate-800 mt-1">
              <div className="h-1.5 rounded bg-emerald-600" style={{ width: `${div(f.valor, tot) * 100}%` }} />
            </div>
          </li>
        ))}
        {!filas.length && <li className="text-sm text-slate-500">Sin datos</li>}
      </ul>
    </section>
  );
}

export default function Estadisticas() {
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [res, setRes] = useState<{ periodo: Periodo; data?: Data; err?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/estadisticas?periodo=${periodo}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { periodo, err: d.error } : { periodo, data: d }))
      .catch((e) => vivo && setRes({ periodo, err: String(e) }));
    return () => { vivo = false; };
  }, [periodo]);

  const d = res?.periodo === periodo ? res.data : undefined;
  const err = res?.periodo === periodo ? res.err : '';
  const a = d?.actual;
  const b = d?.anterior;
  const maxDia = Math.max(1, ...(d?.diario ?? []).map((x) => x.visitas));
  const pasos = a
    ? [
        { t: 'Visitas', v: a.visitas },
        { t: 'Vieron un producto', v: a.producto },
        { t: 'Llegaron al checkout', v: a.checkout },
        { t: 'Compraron', v: a.compras },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Estadísticas" subtitle="Tienda online (Empretienda) · visitas de Google Analytics" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-lg bg-slate-900 border border-slate-800 p-0.5">
            {PERIODOS.map((p) => (
              <button key={p.id} onClick={() => setPeriodo(p.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${periodo === p.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-500">{VS[periodo]}</span>
          {err && <span className="text-sm text-red-400">{err}</span>}
          {!d && !err && <span className="text-sm text-slate-400">Cargando…</span>}
        </div>

        {d && a && b && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Kpi titulo="Visitas" valor={num(a.visitas)} a={a.visitas} b={b.visitas} />
              <Kpi titulo="Visitantes únicos" valor={num(a.usuarios)} a={a.usuarios} b={b.usuarios} />
              <Kpi titulo="Conversión real (ventas ÷ visitas)" valor={d.empretienda ? pct(div(d.empretienda.ventas, a.visitas)) : '—'} nota="con ventas de Empretienda" />
              <Kpi titulo="Conversión GA4" valor={pct(div(a.compras, a.visitas))} a={div(a.compras, a.visitas)} b={div(b.compras, b.visitas)} />
              <Kpi titulo="Ventas Empretienda" valor={d.empretienda ? num(d.empretienda.ventas) : '—'} nota="sin Local (Acordar)" />
              <Kpi titulo="Facturación online" valor={d.empretienda ? pesos(d.empretienda.monto) : '—'} nota={d.empretienda ? `ticket ${pesos(div(d.empretienda.monto, d.empretienda.ventas))}` : undefined} />
              <Kpi titulo="Facturación por visita" valor={d.empretienda ? pesos(div(d.empretienda.monto, a.visitas)) : '—'} nota="cuánto deja cada visita" />
              <Kpi titulo="Tiempo promedio" valor={durac(a.duracion)} a={a.duracion} b={b.duracion} />
            </div>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Embudo de conversión</h2>
              <div className="space-y-3">
                {pasos.map((p, i) => (
                  <div key={p.t}>
                    <div className="flex justify-between text-sm gap-2">
                      <span>{p.t}</span>
                      <span className="tabular-nums text-slate-300">
                        {num(p.v)} <span className="text-slate-500">· {pct(div(p.v, a.visitas), 1)} del total</span>
                        {i > 0 && <span className="text-amber-300"> · {pct(div(p.v, pasos[i - 1].v), 1)} del paso anterior</span>}
                      </span>
                    </div>
                    <div className="h-6 rounded bg-slate-800 mt-1">
                      <div className="h-6 rounded bg-emerald-600" style={{ width: `${Math.max(0.5, div(p.v, a.visitas) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-3">
                Visitas únicas que pasaron por cada paso. &quot;Producto&quot; = páginas /categoría/producto (incluye algunas subcategorías). &quot;Compraron&quot; = llegaron a la página de gracias (/order).
              </p>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Visitas y compras por día</h2>
              <div className="flex items-end gap-1 h-36">
                {d.diario.map((x) => (
                  <div key={x.dia} className="flex-1 h-full flex flex-col justify-end items-center gap-0.5" title={`${x.dia}: ${num(x.visitas)} visitas · ${x.compras} compras · ${pct(div(x.compras, x.visitas))}`}>
                    <span className="text-[10px] text-amber-300 tabular-nums">{x.compras}</span>
                    <div className={`w-full rounded-t ${x.dia >= d.desde ? 'bg-emerald-500' : 'bg-emerald-900'}`} style={{ height: `${(x.visitas / maxDia) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                {d.diario.map((x) => <div key={x.dia} className="flex-1 text-center text-[10px] text-slate-500 overflow-hidden">{x.dia.slice(8)}</div>)}
              </div>
              <p className="text-xs text-slate-500 mt-2">Barras = visitas · número amarillo = compras.</p>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">De dónde vienen</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr><th className="py-1">Canal</th><th className="text-right">Visitas</th><th className="text-right pl-3">Compras</th><th className="text-right pl-3">Conversión</th></tr>
                  </thead>
                  <tbody>
                    {d.canales.map((c) => (
                      <tr key={c.nombre} className="border-t border-slate-800">
                        <td className="py-2">{CANAL[c.nombre] ?? c.nombre}</td>
                        <td className="text-right tabular-nums">{num(c.visitas)}</td>
                        <td className="text-right tabular-nums pl-3">{num(c.compras)}</td>
                        <td className="text-right tabular-nums pl-3 font-semibold">{pct(div(c.compras, c.visitas))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Productos más vistos</h2>
              <ul className="divide-y divide-slate-800">
                {d.productos.map((p) => (
                  <li key={p.path} className="py-2 text-sm flex justify-between gap-3">
                    <a href={`https://www.mateandoarg.com${p.path}`} target="_blank" rel="noreferrer" className="truncate hover:text-emerald-300">{p.titulo || p.path}</a>
                    <span className="shrink-0 tabular-nums text-slate-400">{num(p.visitas)} visitas</span>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Barras titulo="Dispositivo" filas={d.dispositivos.map((x) => ({ nombre: DISP[x.nombre] ?? x.nombre, valor: x.visitas }))} />
              <Barras titulo="Provincia" filas={d.regiones.map((x) => ({ nombre: x.nombre === '(not set)' ? 'Sin dato' : x.nombre === 'Buenos Aires' ? 'CABA' : x.nombre.replace(/ Province$/, ''), valor: x.visitas }))} />
            </div>

            <p className="text-xs text-slate-500">
              Visitas, embudo y canales: Google Analytics. Ventas y facturación: Empretienda{d.empretienda?.updatedAt ? ` (actualizado ${new Date(d.empretienda.updatedAt).toLocaleString('es-AR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })})` : ''}.
              GA4 registra menos compras que las reales (bloqueadores, gente que paga y no vuelve a la página de gracias): sirve para comparar canales y días entre sí, la conversión real es la de Empretienda.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
