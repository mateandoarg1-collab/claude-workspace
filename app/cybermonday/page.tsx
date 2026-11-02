'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';

type Venta = [number, number]; // [minutos desde el inicio del Cyber, monto]
type Canal = 'empretienda' | 'meli';
type Data = {
  inicio2026: string;
  dias: number;
  ahora: number;
  anterior: Record<Canal, Venta[]>;
  actual: Record<Canal, Venta[]>;
  empretiendaActualizado: string | null;
  errores: Record<Canal, string | null>;
};

const CANALES: { id: Canal | 'total'; nombre: string }[] = [
  { id: 'total', nombre: 'Total' },
  { id: 'empretienda', nombre: 'Tienda Online (Empretienda)' },
  { id: 'meli', nombre: 'Mercado Libre' },
];
const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function ventas(d: Data, cual: 'anterior' | 'actual', canal: Canal | 'total') {
  return canal === 'total' ? [...d[cual].empretienda, ...d[cual].meli] : d[cual][canal];
}
function resumen(v: Venta[], desde: number, hasta: number) {
  const f = v.filter(([m]) => m >= desde && m < hasta);
  const monto = f.reduce((s, x) => s + x[1], 0);
  return { monto, pedidos: f.length, ticket: f.length ? monto / f.length : 0 };
}

function Delta({ hoy, antes }: { hoy: number; antes: number }) {
  if (!antes) return <span className="text-slate-500">—</span>;
  const p = hoy / antes - 1;
  return <span className={p >= 0 ? 'text-emerald-400' : 'text-red-400'}>{p >= 0 ? '+' : ''}{(p * 100).toFixed(1)}%</span>;
}

// Acumulado en $ por hora del evento: 2025 completo y 2026 hasta ahora.
function Grafico({ antes, hoy, ahora, total }: { antes: Venta[]; hoy: Venta[]; ahora: number; total: number }) {
  const horas = total / 60;
  const acum = (v: Venta[], hasta: number) => {
    const p: number[] = [];
    for (let h = 0; h <= Math.min(horas, Math.floor(hasta / 60)); h++) p.push(v.filter(([m]) => m < h * 60).reduce((s, x) => s + x[1], 0));
    return p;
  };
  const a = acum(antes, total);
  const b = acum(hoy, ahora);
  b.push(hoy.filter(([m]) => m < ahora).reduce((s, x) => s + x[1], 0));
  const max = Math.max(1, ...a, ...b);
  const x = (h: number) => (h / horas) * 100;
  const y = (v: number) => 98 - (v / max) * 94;
  const linea = (p: number[], ultimaEn?: number) =>
    p.map((v, i) => `${i ? 'L' : 'M'}${x(ultimaEn != null && i === p.length - 1 ? ultimaEn : i)},${y(v)}`).join('');
  return (
    <div>
      <div className="relative h-48">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full overflow-visible">
          {[1, 2].map((d) => <line key={d} x1={x(d * 24)} x2={x(d * 24)} y1={0} y2={100} stroke="currentColor" className="text-slate-800" vectorEffect="non-scaling-stroke" />)}
          <path d={linea(a)} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" className="text-slate-500" strokeDasharray="4 3" />
          <path d={linea(b, ahora / 60)} fill="none" stroke="currentColor" strokeWidth={2.5} vectorEffect="non-scaling-stroke" className="text-emerald-400" />
        </svg>
      </div>
      <div className="flex justify-between text-[11px] text-slate-500 mt-1">
        <span>Día 1</span><span>Día 2</span><span>Día 3</span>
      </div>
      <div className="flex gap-4 text-xs text-slate-400 mt-2">
        <span><span className="inline-block w-3 h-0.5 bg-emerald-400 align-middle mr-1" />2026</span>
        <span><span className="inline-block w-3 h-0.5 bg-slate-500 align-middle mr-1" />2025</span>
        <span className="ml-auto">Máx. {fmt(max)}</span>
      </div>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? a / b - 1 : 0);
const mm = (n: number) => `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
const masMenos = (p: number) => (Math.abs(p) < 0.03 ? 'parejo con el' : `${Math.round(Math.abs(p) * 100)}% ${p > 0 ? 'arriba del' : 'abajo del'}`);

// Lectura en criollo: cómo venimos, quién empuja, pedidos vs ticket y a cuánto cerraríamos el día y el Cyber al ritmo
// de 2025 (lo que falta del día se supone igual que el año pasado, escalado por cómo venimos).
function EnCriollo({ d, dia, ahora, total }: { d: Data; dia: number; ahora: number; total: number }) {
  const r = (c: Canal | 'total', cual: 'anterior' | 'actual', desde: number, hasta: number) => resumen(ventas(d, cual, c), desde, hasta);
  const ini = dia * 1440;
  const hoy = r('total', 'actual', ini, ahora);
  const antes = r('total', 'anterior', ini, ahora);
  const p = pct(hoy.monto, antes.monto);
  const canal = (c: Canal) => ({ hoy: r(c, 'actual', ini, ahora), antes: r(c, 'anterior', ini, ahora) });
  const emp = canal('empretienda');
  const ml = canal('meli');
  const ritmo = antes.monto ? hoy.monto / antes.monto : 1;
  const diaAntes = r('total', 'anterior', ini, ini + 1440).monto;
  const restoDia = diaAntes - antes.monto;
  const cyberAntes = r('total', 'anterior', 0, total).monto;
  const acumHoy = r('total', 'actual', 0, ahora).monto;
  const acumAntes = r('total', 'anterior', 0, ahora).monto;
  const ritmoAcum = acumAntes ? acumHoy / acumAntes : 1;
  const proyCyber = acumHoy + (cyberAntes - acumAntes) * ritmoAcum;
  const frase = (n: string, x: { hoy: ReturnType<typeof resumen>; antes: ReturnType<typeof resumen> }) =>
    `${n}: ${mm(x.hoy.monto)}, ${masMenos(pct(x.hoy.monto, x.antes.monto))} año pasado (${x.hoy.pedidos} pedidos contra ${x.antes.pedidos}).`;
  const ganador = pct(ml.hoy.monto, ml.antes.monto) > pct(emp.hoy.monto, emp.antes.monto) ? 'Mercado Libre' : 'la tienda';
  const pp = pct(hoy.pedidos, antes.pedidos);
  const pt = pct(hoy.ticket, antes.ticket);
  const lineas = [
    `Hoy llevamos ${mm(hoy.monto)}: vamos ${masMenos(p)} año pasado a esta misma hora (${mm(antes.monto)}).`,
    frase('Mercado Libre', ml),
    frase('Tienda online', emp),
    `El que más empuja contra 2025 es ${ganador}.`,
    pp < 0 && pt > 0
      ? `Entran menos pedidos (${Math.round(pp * 100)}%) pero cada uno es más grande: el ticket subió ${Math.round(pt * 100)}% (${fmt(hoy.ticket)} contra ${fmt(antes.ticket)}).`
      : pp > 0 && pt < 0
        ? `Entran más pedidos (+${Math.round(pp * 100)}%) pero más chicos: el ticket bajó ${Math.round(-pt * 100)}% (${fmt(hoy.ticket)} contra ${fmt(antes.ticket)}).`
        : `Pedidos ${pp >= 0 ? '+' : ''}${Math.round(pp * 100)}% y ticket ${pt >= 0 ? '+' : ''}${Math.round(pt * 100)}% contra el año pasado.`,
    `Si seguimos a este ritmo, el día cierra en unos ${mm(hoy.monto + restoDia * ritmo)} (el día ${dia + 1} de 2025 cerró en ${mm(diaAntes)}).`,
    `Y el Cyber completo terminaría en unos ${mm(proyCyber)} contra ${mm(cyberAntes)} de 2025 (${masMenos(pct(proyCyber, cyberAntes)).replace(/ del$| con el$/, '')}).`,
  ];
  return (
    <section className="bg-emerald-950/30 rounded-2xl border border-emerald-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-emerald-300 mb-2">En criollo (Meli + tienda)</h2>
      <ul className="space-y-1.5 text-sm text-slate-200 list-disc pl-5">
        {lineas.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p className="text-xs text-slate-500 mt-2">La proyección supone que lo que falta va igual que el año pasado, escalado por cómo venimos.</p>
    </section>
  );
}

export default function CyberMonday() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    const cargar = () =>
      fetch('/api/cyber', { cache: 'no-store' })
        .then((r) => r.json())
        .then((x) => { setD(x); setErr(''); })
        .catch((e) => setErr(String(e)));
    cargar();
    const t = setInterval(cargar, 2 * 60e3);
    return () => clearInterval(t);
  }, []);

  const total = d ? d.dias * 1440 : 0;
  const ahora = d ? Math.max(0, Math.min(d.ahora, total)) : 0;
  const dia = Math.min(Math.floor(ahora / 1440), (d?.dias ?? 1) - 1);
  const empezo = d ? d.ahora >= 0 : false;

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="CYBERMONDAY" subtitle="2026 vs 2025 (3, 4 y 5 de nov) a la misma hora" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {err && <div className="text-sm text-red-400">{err}</div>}
        {!d && !err && <div className="text-sm text-slate-400">Cargando…</div>}
        {d && (
          <>
            <div className="text-sm text-slate-400">
              {!empezo ? 'Todavía no empezó el Cyber 2026.' : ahora >= total ? 'Cyber terminado.' : <>Día {dia + 1} · {hhmm(ahora % 1440)} h — comparado con el día {dia + 1} de 2025 a la misma hora. Se actualiza cada 2 min.</>}
              {Object.entries(d.errores).filter(([, e]) => e).map(([c, e]) => <div key={c} className="text-red-400">{c}: {e}</div>)}
            </div>

            {empezo && ahora < total && <EnCriollo d={d} dia={dia} ahora={ahora} total={total} />}

            {[
              { titulo: `Hoy (día ${dia + 1}) hasta las ${hhmm(ahora % 1440)}`, desde: dia * 1440, hasta: ahora },
              { titulo: 'Acumulado del Cyber a esta hora', desde: 0, hasta: ahora },
            ].map((b) => (
              <section key={b.titulo} className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-200 mb-3">{b.titulo}</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {CANALES.map((c) => {
                    const hoy = resumen(ventas(d, 'actual', c.id), b.desde, b.hasta);
                    const antes = resumen(ventas(d, 'anterior', c.id), b.desde, b.hasta);
                    return (
                      <div key={c.id} className={`rounded-xl border p-3 ${c.id === 'total' ? 'border-emerald-800 bg-emerald-950/30' : 'border-slate-800 bg-slate-950/40'}`}>
                        <div className="text-xs text-slate-400 mb-2">{c.nombre}</div>
                        {([['Facturado', 'monto', fmt], ['Pedidos', 'pedidos', (n: number) => String(n)], ['Ticket prom.', 'ticket', fmt]] as const).map(([t, k, f]) => (
                          <div key={k} className="flex items-baseline justify-between gap-2 text-sm py-0.5">
                            <span className="text-slate-400">{t}</span>
                            <span className="tabular-nums text-right">
                              <span className={k === 'monto' ? 'text-lg font-bold text-white' : 'text-white'}>{f(hoy[k])}</span>
                              <span className="block text-xs text-slate-500">2025: {f(antes[k])} · <Delta hoy={hoy[k]} antes={antes[k]} /></span>
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Facturado acumulado (Total)</h2>
              <Grafico antes={ventas(d, 'anterior', 'total')} hoy={ventas(d, 'actual', 'total')} ahora={ahora} total={total} />
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5 overflow-x-auto">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Por día</h2>
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-slate-400">
                  <tr className="text-left">
                    <th className="py-1 pr-3 font-normal">Día</th>
                    <th className="py-1 pr-3 font-normal">Canal</th>
                    <th className="py-1 pr-3 font-normal text-right">2025 completo</th>
                    <th className="py-1 pr-3 font-normal text-right">2026</th>
                    <th className="py-1 font-normal text-right">Pedidos 25 → 26</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: d.dias }, (_, i) =>
                    CANALES.map((c) => {
                      const antes = resumen(ventas(d, 'anterior', c.id), i * 1440, (i + 1) * 1440);
                      const hoy = resumen(ventas(d, 'actual', c.id), i * 1440, Math.min((i + 1) * 1440, ahora));
                      return (
                        <tr key={`${i}${c.id}`} className={`border-t border-slate-800 ${c.id === 'total' ? 'font-semibold' : 'text-slate-300'}`}>
                          <td className="py-1.5 pr-3">{c.id === 'total' ? `Día ${i + 1}` : ''}</td>
                          <td className="py-1.5 pr-3">{c.id === 'total' ? 'Total' : c.id === 'meli' ? 'Meli' : 'Empretienda'}</td>
                          <td className="py-1.5 pr-3 text-right">{fmt(antes.monto)}</td>
                          <td className="py-1.5 pr-3 text-right">{i * 1440 <= ahora ? fmt(hoy.monto) : '—'}</td>
                          <td className="py-1.5 text-right">{antes.pedidos} → {i * 1440 <= ahora ? hoy.pedidos : '—'}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </section>

            <p className="text-xs text-slate-500">
              Empretienda: ventas online pagadas más transferencias pendientes (se tildan y se controlan después con Aginco), sin local «a acordar», subtotal menos descuentos, sin envío; se lee cada 30 min
              {d.empretiendaActualizado && <> (última orden leída: {new Date(d.empretiendaActualizado).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })})</>}.
              2025 sale del export del panel. Meli: órdenes pagadas por API, agrupadas por carrito.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
