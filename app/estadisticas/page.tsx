'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import type { Periodo } from '@/lib/periodo';

type Resumen = {
  visitas: number; usuarios: number; duracion: number; producto: number; checkout: number;
  intentos: number; pagadas: number; monto: number; pendientes: number; montoPendiente: number; fallidas: number; montoFallido: number;
};
type Prod = { id: string; nombre: string; imagen: string; path: string | null; visitas: number; vendidas: number };
type Data = {
  periodo: Periodo;
  desde: string;
  actual: Resumen;
  anterior: Resumen;
  rastreadas: number;
  diario: { dia: string; visitas: number; ventas: number; monto: number }[];
  canales: { nombre: string; visitas: number; ventas: number; monto: number }[];
  dispositivos: { nombre: string; visitas: number }[];
  masVistos: Prod[];
  masVendidos: Prod[];
  provincias: { nombre: string; ventas: number; monto: number }[];
};

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];
const VS: Record<Periodo, string> = { hoy: 'vs ayer', ayer: 'vs anteayer', semana: 'vs 7 días previos', mes: 'vs los mismos días antes' };

const num = (n: number) => Math.round(n).toLocaleString('es-AR');
const pesos = (n: number) => '$' + num(n);
const millones = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : pesos(n));
const pct = (n: number, d = 2) => (n * 100).toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%';
const div = (a: number, b: number) => (b ? a / b : 0);
const DISP: Record<string, string> = { mobile: 'Celular', desktop: 'Computadora', tablet: 'Tablet' };
const CANAL: Record<string, string> = {
  'Paid Social': 'Meta pago', 'Organic Social': 'Redes orgánicas', Direct: 'Directo / WhatsApp', 'Organic Search': 'Google orgánico',
  'Paid Search': 'Google Ads', 'Cross-network': 'Google PMax', Referral: 'Otros sitios', Unassigned: 'Sin asignar', Email: 'Email',
  'AI Assistant': 'Asistentes IA', 'Organic Shopping': 'Google Shopping', 'Paid Other': 'Otros pagos', 'Mobile Push Notifications': 'Notificaciones push',
  'Sin rastrear': 'Sin rastrear (GA4 no la vio)',
};
const capitalizar = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

function Delta({ a, b }: { a: number; b: number }) {
  if (!b) return <span className="text-xs text-slate-500">—</span>;
  const v = a / b - 1;
  return <span className={`text-xs tabular-nums ${Math.abs(v) < 0.005 ? 'text-slate-400' : v > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{v > 0 ? '▲' : '▼'} {pct(Math.abs(v), 0)}</span>;
}

function Kpi({ titulo, valor, a, b, nota, destacado }: { titulo: string; valor: string; a?: number; b?: number; nota?: string; destacado?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${destacado ? 'bg-emerald-950/40 border-emerald-800' : 'bg-slate-900 border-slate-800'}`}>
      <div className="text-xs text-slate-400">{titulo}</div>
      <div className="text-xl font-bold tabular-nums mt-0.5">{valor}</div>
      <div className="flex gap-2 items-baseline">
        {a != null && b != null && <Delta a={a} b={b} />}
        {nota && <span className="text-xs text-slate-500">{nota}</span>}
      </div>
    </div>
  );
}

function Foto({ src }: { src: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className="w-10 h-10 rounded-md bg-white object-contain shrink-0" />
  ) : (
    <div className="w-10 h-10 rounded-md bg-slate-800 shrink-0" />
  );
}

function Productos({ titulo, filas }: { titulo: string; filas: Prod[] }) {
  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-2">{titulo}</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr><th className="py-1">Producto</th><th className="text-right">Visitas</th><th className="text-right pl-2">Vend.</th><th className="text-right pl-2">Conv.</th></tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.id} className="border-t border-slate-800">
              <td className="py-1.5 pr-2">
                <a href={p.path ? `https://www.mateandoarg.com${p.path}` : undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-emerald-300">
                  <Foto src={p.imagen} />
                  <span className="line-clamp-2 text-xs sm:text-sm">{capitalizar(p.nombre)}</span>
                </a>
              </td>
              <td className="text-right tabular-nums">{num(p.visitas)}</td>
              <td className="text-right tabular-nums pl-2">{num(p.vendidas)}</td>
              <td className="text-right tabular-nums pl-2 font-semibold">{p.visitas >= 30 ? pct(div(p.vendidas, p.visitas), 1) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Barras({ titulo, filas }: { titulo: string; filas: { nombre: string; valor: number; extra?: string }[] }) {
  const tot = filas.reduce((s, f) => s + f.valor, 0);
  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200 mb-3">{titulo}</h2>
      <ul className="space-y-2">
        {filas.slice(0, 8).map((f) => (
          <li key={f.nombre} className="text-sm">
            <div className="flex justify-between gap-2">
              <span className="truncate">{f.nombre}</span>
              <span className="tabular-nums text-slate-400 shrink-0">{num(f.valor)} · {pct(div(f.valor, tot), 0)}{f.extra ? ` · ${f.extra}` : ''}</span>
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
        { t: 'Entraron a la tienda', v: a.visitas, f: 'GA4' },
        { t: 'Vieron un producto', v: a.producto, f: 'GA4' },
        { t: 'Llegaron al checkout', v: a.checkout, f: 'GA4' },
        { t: 'Generaron una orden', v: a.intentos, f: 'Empretienda' },
        { t: 'Pagaron', v: a.pagadas, f: 'Empretienda' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Estadísticas" subtitle="Tienda online · visitas de Google Analytics, ventas reales de Empretienda" width="5xl" />
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
              <Kpi titulo="Visitas" valor={num(a.visitas)} a={a.visitas} b={b.visitas} nota={`${num(a.usuarios)} personas`} />
              <Kpi titulo="Ventas pagadas" valor={num(a.pagadas)} a={a.pagadas} b={b.pagadas} />
              <Kpi titulo="Conversión" valor={pct(div(a.pagadas, a.visitas))} a={div(a.pagadas, a.visitas)} b={div(b.pagadas, b.visitas)} destacado />
              <Kpi titulo="Facturación" valor={millones(a.monto)} a={a.monto} b={b.monto} />
              <Kpi titulo="Ticket promedio" valor={pesos(div(a.monto, a.pagadas))} a={div(a.monto, a.pagadas)} b={div(b.monto, b.pagadas)} />
              <Kpi titulo="Facturación por visita" valor={pesos(div(a.monto, a.visitas))} a={div(a.monto, a.visitas)} b={div(b.monto, b.visitas)} />
              <Kpi titulo="Pagos fallidos" valor={num(a.fallidas)} nota={`${millones(a.montoFallido)} que no entraron`} />
              <Kpi titulo="Transferencias pendientes" valor={num(a.pendientes)} nota={millones(a.montoPendiente)} />
            </div>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Embudo de conversión</h2>
              <div className="space-y-3">
                {pasos.map((p, i) => (
                  <div key={p.t}>
                    <div className="flex justify-between text-sm gap-2 flex-wrap">
                      <span>{p.t} <span className="text-[10px] text-slate-500">{p.f}</span></span>
                      <span className="tabular-nums text-slate-300">
                        {num(p.v)}
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
                Las órdenes que no se pagaron: {num(a.fallidas)} con pago rechazado o abandonado y {num(a.pendientes)} transferencias sin confirmar todavía.
              </p>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Visitas y ventas por día</h2>
              <div className="flex items-end gap-1 h-36">
                {d.diario.map((x) => (
                  <div key={x.dia} className="flex-1 h-full flex flex-col justify-end items-center gap-0.5"
                    title={`${x.dia}: ${num(x.visitas)} visitas · ${x.ventas} ventas · ${pesos(x.monto)} · conversión ${pct(div(x.ventas, x.visitas))}`}>
                    <span className="text-[10px] text-amber-300 tabular-nums">{x.ventas}</span>
                    <div className={`w-full rounded-t ${x.dia >= d.desde ? 'bg-emerald-500' : 'bg-emerald-900'}`} style={{ height: `${(x.visitas / maxDia) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-1 mt-1">
                {d.diario.map((x) => <div key={x.dia} className="flex-1 text-center text-[10px] text-slate-500 overflow-hidden">{x.dia.slice(8)}</div>)}
              </div>
              <p className="text-xs text-slate-500 mt-2">Barras = visitas · número amarillo = ventas pagadas.</p>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Ventas por canal</h2>
              <p className="text-xs text-slate-500 mb-3">
                Cada venta real cruzada con la visita en la que se compró ({num(d.rastreadas)} de {num(a.pagadas)}, {pct(div(d.rastreadas, a.pagadas), 0)}).
                Es el canal de esa última visita: si alguien vio un anuncio y después volvió escribiendo la dirección, cuenta como Directo.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr><th className="py-1">Canal</th><th className="text-right">Visitas</th><th className="text-right pl-3">Ventas</th><th className="text-right pl-3">Facturación</th><th className="text-right pl-3">Conv.</th></tr>
                  </thead>
                  <tbody>
                    {d.canales.filter((c) => c.visitas >= 20 || c.ventas).map((c) => (
                      <tr key={c.nombre} className="border-t border-slate-800">
                        <td className={`py-2 ${c.nombre === 'Sin rastrear' ? 'text-slate-500' : ''}`}>{CANAL[c.nombre] ?? c.nombre}</td>
                        <td className="text-right tabular-nums">{c.visitas ? num(c.visitas) : '—'}</td>
                        <td className="text-right tabular-nums pl-3">{num(c.ventas)}</td>
                        <td className="text-right tabular-nums pl-3">{millones(c.monto)}</td>
                        <td className="text-right tabular-nums pl-3 font-semibold">{c.visitas ? pct(div(c.ventas, c.visitas)) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Productos titulo="Más vendidos" filas={d.masVendidos} />
              <Productos titulo="Más vistos" filas={d.masVistos} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Barras titulo="Ventas por provincia" filas={d.provincias.map((x) => ({ nombre: capitalizar(x.nombre), valor: x.ventas, extra: millones(x.monto) }))} />
              <Barras titulo="Dispositivo (visitas)" filas={d.dispositivos.map((x) => ({ nombre: DISP[x.nombre] ?? x.nombre, valor: x.visitas }))} />
            </div>

            <p className="text-xs text-slate-500">
              Ventas = órdenes pagadas de Empretienda sin Acordar (Local), actualizadas cada 30 min. Visitas y navegación = Google Analytics, que no ve a quien
              usa bloqueadores: las visitas reales son algo más y la conversión real algo menos. Conversión por producto: solo con 30 visitas o más.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
