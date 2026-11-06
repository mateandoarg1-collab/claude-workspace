'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';
import CpaMax from './CpaMax';

// Rendimiento de pauta por anuncio (Meta): miniatura del creativo, ordenado de mejor a peor por CPA, ROAS o CTR.

type Anuncio = {
  id: string; nombre: string; conjunto: string; campana: string; miniatura: string | null; estado: string | null; video: boolean;
  gasto: number; compras: number; facturacion: number; impresiones: number; clics: number;
  cpa: number | null; roas: number | null; ctr: number | null;
};
type Cuenta = { id: string; nombre: string };
type Orden = 'roas' | 'cpa' | 'ctr';

const PERIODOS = [
  { v: 'today', l: 'Hoy' }, { v: 'yesterday', l: 'Ayer' }, { v: 'last_7d', l: '7 días' },
  { v: 'last_14d', l: '14 días' }, { v: 'last_30d', l: '30 días' }, { v: 'this_month', l: 'Mes' },
];
const ORDENES: Array<{ v: Orden; l: string; ayuda: string }> = [
  { v: 'roas', l: 'ROAS', ayuda: 'mayor es mejor' },
  { v: 'cpa', l: 'CPA', ayuda: 'menor es mejor' },
  { v: 'ctr', l: 'CTR', ayuda: 'mayor es mejor' },
];
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const sel = 'rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100';

// De mejor a peor; los que no tienen el dato (sin compras / sin impresiones) van al final, por gasto.
function ordenar(lista: Anuncio[], orden: Orden) {
  return [...lista].sort((a, b) => {
    const x = a[orden], y = b[orden];
    if (x === null && y === null) return b.gasto - a.gasto;
    if (x === null) return 1;
    if (y === null) return -1;
    return orden === 'cpa' ? x - y : y - x;
  });
}

export default function RendimientoPage() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuenta, setCuenta] = useState('');
  const [periodo, setPeriodo] = useState('last_7d');
  const [orden, setOrden] = useState<Orden>('roas');
  const [soloActivos, setSoloActivos] = useState(false);
  const [minGasto, setMinGasto] = useState(0);
  // El resultado guarda para qué cuenta/período es: si no coincide con lo elegido, está cargando.
  const clave = `${cuenta}|${periodo}`;
  const [res, setRes] = useState<{ clave: string; anuncios: Anuncio[]; error: string }>({ clave: '', anuncios: [], error: '' });
  const cargando = !!cuenta && res.clave !== clave;
  const datos = cargando ? [] : res.anuncios;
  const error = cargando ? '' : res.error;

  useEffect(() => {
    fetch('/api/anuncios/cuentas').then((r) => r.json()).then((j) => {
      setCuentas(j.cuentas ?? []);
      if (j.cuentas?.[0]) setCuenta(j.cuentas[0].id);
    });
  }, []);

  useEffect(() => {
    if (!cuenta) return;
    const k = `${cuenta}|${periodo}`;
    fetch(`/api/anuncios/rendimiento?cuenta=${cuenta}&periodo=${periodo}`).then((r) => r.json())
      .then((j) => setRes({ clave: k, anuncios: j.anuncios ?? [], error: j.error ?? '' }))
      .catch((e) => setRes({ clave: k, anuncios: [], error: String(e) }));
  }, [cuenta, periodo]);

  const lista = ordenar(datos.filter((a) => a.gasto >= minGasto && (!soloActivos || a.estado === 'ACTIVE')), orden);
  const tot = lista.reduce((s, a) => ({ g: s.g + a.gasto, c: s.c + a.compras, f: s.f + a.facturacion, i: s.i + a.impresiones, k: s.k + a.clics }), { g: 0, c: 0, f: 0, i: 0, k: 0 });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Rendimiento de pauta" subtitle="Meta · anuncios de mejor a peor" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />

        <div className="flex flex-wrap gap-2 items-center">
          <select className={sel} value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          <select className={sel} value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Gasto mín.
            <input type="number" className={`${sel} w-28`} value={minGasto} onChange={(e) => setMinGasto(Number(e.target.value) || 0)} />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)} /> Solo activos
          </label>
        </div>

        {cuenta && <CpaMax cuenta={cuenta} nombreCuenta={cuentas.find((c) => c.id === cuenta)?.nombre ?? cuenta} />}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Ordenar por:</span>
          {ORDENES.map((o) => (
            <button key={o.v} onClick={() => setOrden(o.v)}
              className={`rounded-full px-3 py-1.5 text-sm ${orden === o.v ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-slate-900 text-slate-400 hover:text-slate-100'}`}>
              {o.l} <span className="text-xs opacity-60">({o.ayuda})</span>
            </button>
          ))}
        </div>

        {!cargando && !error && lista.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[
              ['Gasto (c/recargo)', $(tot.g)],
              ['ROAS', tot.g ? `${(tot.f / tot.g).toFixed(2)}x` : '—'],
              ['CPA', tot.c ? $(tot.g / tot.c) : '—'],
              ['CTR', tot.i ? `${((tot.k / tot.i) * 100).toFixed(2)}%` : '—'],
            ].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2">
                <p className="text-xs text-slate-500">{l}</p><p className="font-semibold">{v}</p>
              </div>
            ))}
          </div>
        )}

        {cargando && <p className="text-sm text-slate-400">Cargando anuncios…</p>}
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {!cargando && !error && lista.length === 0 && <p className="text-sm text-slate-500">No hay anuncios con gasto en este período.</p>}

        <div className="space-y-2">
          {lista.map((a, i) => (
            <div key={a.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex gap-3 items-center">
              <span className={`w-6 text-center text-sm font-semibold ${i < 3 ? 'text-emerald-300' : 'text-slate-500'}`}>{i + 1}</span>
              <div className="relative w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 rounded-lg overflow-hidden bg-slate-950">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.miniatura && <img src={a.miniatura} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                {a.video && <span className="absolute bottom-0.5 right-0.5 text-[10px] bg-black/70 rounded px-1">🎬</span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.nombre}</p>
                <p className="text-xs text-slate-500 truncate">{a.campana} · {a.conjunto}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {a.estado === 'ACTIVE' ? <span className="text-emerald-400">● Activo</span> : <span>○ {a.estado?.toLowerCase() ?? '—'}</span>}
                  {' · '}Gasto {$(a.gasto)} · {a.compras} compras · Fact. {$(a.facturacion)}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 text-right text-sm flex-shrink-0">
                {(['roas', 'cpa', 'ctr'] as const).map((k) => (
                  <div key={k} className={orden === k ? 'text-emerald-300' : 'text-slate-300'}>
                    <p className="text-[10px] uppercase text-slate-500">{k}</p>
                    <p className="font-semibold tabular-nums">
                      {a[k] === null ? '—' : k === 'roas' ? `${a[k]!.toFixed(2)}x` : k === 'cpa' ? $(a[k]!) : `${a[k]!.toFixed(2)}%`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
