'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';
import { estado, HORIZONTE, LEAD_TIME, proyectar, SAFETY, UNIDADES_CAJA } from '@/lib/chinaProyeccion';

type Canal = 'MeLi' | 'Empre' | 'Local' | 'Shopify' | 'Mayorista';
type Fila = {
  producto: string;
  color: string;
  llegaron: number;
  vendidos: number;
  porCanal: Record<Canal, number>;
  stock: number | null;
  full: number;
  foto: string | null;
  porDia: number;
  porDiaCanal: Record<Canal, number>;
  base: number;
  tendencia: number | null;
};
type Data = {
  generado: string;
  desde: string;
  hoy: string;
  conteo: string | null;
  canales: Record<Canal, number>;
  total: number;
  porDia: number;
  sinColor: number;
  errores: string[];
  filas: Fila[];
};

const CANALES: { k: Canal; label: string; corto: string; color: string }[] = [
  { k: 'MeLi', label: 'Mercado Libre', corto: 'ML', color: 'bg-amber-400' },
  { k: 'Empre', label: 'Empretienda', corto: 'Web', color: 'bg-emerald-500' },
  { k: 'Local', label: 'Local', corto: 'Local', color: 'bg-sky-400' },
  { k: 'Shopify', label: 'Shopify', corto: 'Shop', color: 'bg-lime-300' },
  { k: 'Mayorista', label: 'Mayorista', corto: 'May', color: 'bg-violet-400' },
];
const SWATCH: Record<string, string> = { Negro: 'bg-neutral-900 ring-slate-500', Rosa: 'bg-pink-300 ring-pink-200', Beige: 'bg-amber-100 ring-amber-50', Blanco: 'bg-white ring-slate-300' };
const BOOSTS = [0.25, 0.5, 1, 2];
const COBERTURAS = [{ meses: 6, dias: 182 }, { meses: 9, dias: 273 }, { meses: 12, dias: 365 }];
const CRECIMIENTOS = [0, 0.03];
const CONTAINER_ANTERIOR = { unidades: 19800, cajas: 780 };
type Opc = { cobertura: number; crecimiento: number };
const cajas = (producto: string, u: number) => Math.ceil(u / (UNIDADES_CAJA[producto] ?? 25));
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const n0 = (n: number) => Math.round(n).toLocaleString('es-AR');
const n1 = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dia = (iso: string | null) => (iso ? `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}${iso.slice(0, 4) !== new Date().getFullYear().toString() ? ` ${iso.slice(2, 4)}` : ''}` : '+3 años');

const ESTADO = {
  critico: { t: 'Crítico', c: 'bg-red-500/15 text-red-300 ring-red-500/30', d: 'text-red-300' },
  atencion: { t: 'Atención', c: 'bg-amber-500/15 text-amber-300 ring-amber-500/30', d: 'text-amber-300' },
  ok: { t: 'OK', c: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', d: 'text-slate-100' },
};

// Curva de stock de hoy a +135 días, con las marcas de lead time (si pedís hoy, llega acá) y safety.
function Curva({ curva }: { curva: number[] }) {
  const W = 300, H = 70;
  const max = Math.max(1, curva[0]);
  const x = (i: number) => (i / HORIZONTE) * W;
  const y = (v: number) => 4 + (1 - v / max) * (H - 6);
  const linea = curva.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16" preserveAspectRatio="none" aria-hidden>
        <polygon points={`0,${H} ${linea} ${W},${H}`} className="fill-emerald-400/10" />
        <polyline points={linea} fill="none" className="stroke-emerald-300" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={x(LEAD_TIME)} x2={x(LEAD_TIME)} y1="0" y2={H} className="stroke-red-400/70" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <line x1={x(LEAD_TIME + SAFETY)} x2={x(LEAD_TIME + SAFETY)} y1="0" y2={H} className="stroke-slate-500" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-slate-700" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative h-4 text-[10px] text-slate-500">
        <span className="absolute left-0">Hoy</span>
        <span className="absolute -translate-x-1/2 text-red-300/80" style={{ left: `${(LEAD_TIME / HORIZONTE) * 100}%` }}>Lead time</span>
        <span className="absolute right-0">+{HORIZONTE}d</span>
      </div>
    </div>
  );
}

function Tarjeta({ f, hoy, opc }: { f: Fila; hoy: string; opc: Opc }) {
  const [boost, setBoost] = useState(0);
  const p = useMemo(() => proyectar(f.stock ?? 0, f.base, hoy, { ...opc, boost }), [f, hoy, opc, boost]);
  const e = ESTADO[estado(p.dias)];
  const caja = UNIDADES_CAJA[f.producto] ?? 25;
  const totalCanal = CANALES.reduce((s, c) => s + f.porDiaCanal[c.k], 0);
  const vendidoPct = Math.round((f.vendidos / f.llegaron) * 100);
  return (
    <article className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden flex flex-col">
      <div className="p-4 pb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-3">
          {f.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={f.foto} alt="" className="w-12 h-12 shrink-0 rounded-lg bg-white object-contain ring-1 ring-slate-700" />
          ) : (
            <div className="w-12 h-12 shrink-0 rounded-lg bg-slate-800 flex items-center justify-center">🇨🇳</div>
          )}
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-mono">🇨🇳 {f.producto}</div>
            <h3 className="text-base font-semibold text-slate-50 flex items-center gap-2">
              <span className={`inline-block w-3 h-3 shrink-0 rounded-full ring-1 ${SWATCH[f.color] ?? 'bg-slate-500'}`} />
              <span className="truncate">{f.producto} {f.color}</span>
            </h3>
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${e.c}`}>● {e.t}</span>
      </div>

      <div className="px-4">
        <Curva curva={p.curva} />
      </div>

      <div className="px-4 pt-2 pb-3 grid grid-cols-3 gap-2">
        <div>
          <div className="text-xs text-slate-500">Stock</div>
          <div className="text-2xl font-semibold tabular-nums">{f.stock == null ? '—' : n0(f.stock)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Días</div>
          <div className={`text-2xl font-semibold tabular-nums ${e.d}`}>{p.dias == null ? '+3 años' : `${p.dias}d`}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Quiebre</div>
          <div className="text-2xl font-semibold tabular-nums">{dia(p.agota)}</div>
        </div>
        <div className="col-span-3 text-xs text-slate-500 tabular-nums">
          Full {n0(f.full)} · Local + depósito {f.stock == null ? '—' : n0(Math.max(0, f.stock - f.full))} · vendido {n0(f.vendidos)} de {n0(f.llegaron)} ({vendidoPct}%)
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-800 space-y-2">
        <div className="flex items-baseline justify-between gap-2 text-sm">
          <div className="tabular-nums min-w-0 truncate">
            <b className="text-slate-100">{n1(f.porDia)}</b> <span className="text-slate-400">ud/día</span>
            <span className="text-slate-500">
              {CANALES.filter((c) => f.porDiaCanal[c.k] >= 0.05).map((c) => ` · ${c.corto} ${n1(f.porDiaCanal[c.k])}`)}
            </span>
          </div>
          {f.tendencia != null && (
            <span className={`shrink-0 text-xs tabular-nums ${f.tendencia >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
              {f.tendencia >= 0 ? '+' : ''}{Math.round(f.tendencia * 100)}% sem.
            </span>
          )}
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden flex">
          {totalCanal > 0 && CANALES.map((c) => <div key={c.k} className={c.color} style={{ width: `${(f.porDiaCanal[c.k] / totalCanal) * 100}%` }} />)}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
          {totalCanal > 0 && CANALES.filter((c) => f.porDiaCanal[c.k] > 0).map((c) => (
            <span key={c.k} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${c.color}`} />{c.label} {Math.round((f.porDiaCanal[c.k] / totalCanal) * 100)}%
            </span>
          ))}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-800">
        <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-2">Boost de demanda</div>
        <div className="flex gap-2">
          {BOOSTS.map((b) => (
            <button key={b} onClick={() => setBoost(boost === b ? 0 : b)}
              className={`rounded-lg px-2.5 py-1 text-xs tabular-nums ring-1 transition-colors ${boost === b ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40' : 'bg-slate-950 text-slate-300 ring-slate-800 hover:ring-slate-600'}`}>
              +{b * 100}%
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto px-4 py-3 border-t border-slate-800 bg-slate-950/40 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-400">
          Sugerido: <b className="text-slate-100 tabular-nums">{n0(p.sugerido)} ud</b>
        </span>
        <span className="text-slate-300 tabular-nums">{n0(cajas(f.producto, p.sugerido))} cajas × {caja}</span>
      </div>
    </article>
  );
}

export default function China() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opc, setOpc] = useState<Opc>({ cobertura: 273, crecimiento: 0 });

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/china', { cache: 'no-store' });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  useEffect(() => {
    Promise.resolve().then(load);
  }, []);

  // Más urgente primero (sin boost), y el pedido sugerido total con la cobertura y el crecimiento elegidos.
  const { filas, pedido } = useMemo(() => {
    const p = (data?.filas ?? []).map((f) => ({ f, p: proyectar(f.stock ?? 0, f.base, data!.hoy, opc) }));
    return {
      filas: [...p].sort((a, b) => (a.p.dias ?? 1e9) - (b.p.dias ?? 1e9) || b.f.porDia - a.f.porDia).map((x) => x.f),
      pedido: {
        unidades: p.reduce((s, x) => s + x.p.sugerido, 0),
        cajas: p.reduce((s, x) => s + cajas(x.f.producto, x.p.sugerido), 0),
        items: p.filter((x) => x.p.sugerido > 0).sort((a, b) => b.p.sugerido - a.p.sugerido),
      },
    };
  }, [data, opc]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader
        title="Container China"
        subtitle={data ? `Ventas desde el 1/9 · stock del conteo ${dia(data.conteo)} menos lo vendido · actualizado ${new Date(data.generado).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : 'Ventas y stock en vivo'}
        width="7xl"
      />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {CANALES.map((c) => (
            <div key={c.k} className="rounded-xl bg-slate-900 border border-slate-800 p-3">
              <div className="text-xs text-slate-400 flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${c.color}`} />{c.label}</div>
              <div className="text-xl font-semibold tabular-nums">{data ? n0(data.canales[c.k]) : '…'}</div>
            </div>
          ))}
          <div className="rounded-xl bg-emerald-950/40 border border-emerald-800 p-3">
            <div className="text-xs text-emerald-300">Total vendido</div>
            <div className="text-xl font-semibold tabular-nums">{data ? n0(data.total) : '…'}</div>
            <div className="text-[11px] text-slate-400 tabular-nums">{data ? `${n1(data.porDia)}/día` : ''}</div>
          </div>
        </section>

        <div className="flex items-center gap-2 text-sm">
          <button onClick={load} disabled={loading} className="rounded-full px-3 py-1.5 bg-slate-900 border border-slate-800 text-slate-300 disabled:opacity-50">
            {loading ? 'Cargando…' : '↻ Actualizar'}
          </button>
          <span className="text-xs text-slate-500">Lead time {LEAD_TIME} días · safety {SAFETY}</span>
        </div>

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">El pedido cubre</span>
              {COBERTURAS.map((c) => (
                <button key={c.meses} onClick={() => setOpc({ ...opc, cobertura: c.dias })}
                  className={`rounded-lg px-2.5 py-1 text-xs ring-1 ${opc.cobertura === c.dias ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40' : 'bg-slate-950 text-slate-300 ring-slate-800'}`}>
                  {c.meses} meses
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Crecimiento</span>
              {CRECIMIENTOS.map((c) => (
                <button key={c} onClick={() => setOpc({ ...opc, crecimiento: c })}
                  className={`rounded-lg px-2.5 py-1 text-xs ring-1 ${opc.crecimiento === c ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/40' : 'bg-slate-950 text-slate-300 ring-slate-800'}`}>
                  {c === 0 ? 'Sin crecimiento' : `+${c * 100}%/mes`}
                </button>
              ))}
            </div>
          </div>
          {data && (
            <div>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-sm text-slate-400">Pedido sugerido</span>
                <span className="text-2xl font-semibold tabular-nums">{n0(pedido.unidades)} ud</span>
                <span className="text-slate-300 tabular-nums">· {n0(pedido.cajas)} cajas</span>
                <span className="text-xs text-slate-500 tabular-nums">(el container anterior: {n0(CONTAINER_ANTERIOR.unidades)} ud · {CONTAINER_ANTERIOR.cajas} cajas)</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 tabular-nums">
                {pedido.items.map((x) => `${x.f.producto} ${x.f.color} ${n0(x.p.sugerido)}`).join(' · ')}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                = lo que se vende en los {LEAD_TIME} días que tarda en llegar + {opc.cobertura === 365 ? 'un año' : `${COBERTURAS.find((c) => c.dias === opc.cobertura)?.meses} meses`} después, menos el stock actual.
              </p>
            </div>
          )}
        </section>

        {error && <div className="rounded bg-red-950 text-red-300 p-3 text-sm">{error}</div>}
        {data?.errores.map((x) => (
          <div key={x} className="rounded bg-amber-950 text-amber-300 p-3 text-sm">No se pudo leer {x} — los números no incluyen ese canal.</div>
        ))}
        {loading && !data && <div className="text-slate-400 text-sm">Juntando ventas de MeLi, Empretienda, Shopify y mayorista… (tarda unos segundos)</div>}

        {data && (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filas.map((f) => <Tarjeta key={`${f.producto}|${f.color}`} f={f} hoy={data.hoy} opc={opc} />)}
          </section>
        )}

        {data && (
          <p className="text-xs text-slate-500 leading-relaxed">
            Stock = conteo físico del {dia(data.conteo)} (Full + Local + depósito Paraguay) menos todo lo vendido desde el día siguiente. Para cargar un
            conteo nuevo: pestaña <b>china_conteo</b> de la planilla MATEANDO MAYORISTA 2026, filas con la fecha nueva. Los kits se cuentan por pieza
            (termo + mate). Ritmo: MeLi, web, local y Shopify = promedio de los últimos 30 días; mayorista = promedio desde el 1/9 (llega en pedidos grandes y
            sueltos). La proyección suma Cyber, Navidad, regalos empresariales, Hot Sale y Día del Padre, y el crecimiento elegido arriba. {data.sinColor > 0 && `${n0(data.sinColor)} unidades vendidas sin color identificado (mayorista o kits) no se descuentan de ningún color.`}
          </p>
        )}
      </main>
    </div>
  );
}
