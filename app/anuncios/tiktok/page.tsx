'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';

// Rendimiento de TikTok Ads por anuncio y por campaña (ver app/api/anuncios/tiktok).
type Anuncio = {
  id: string; nombre: string; campana: string; conjunto: string; gasto: number; compras: number; facturacion: number;
  impresiones: number; clics: number; cpa: number | null; roas: number | null; ctr: number | null;
};
type Orden = 'roas' | 'cpa' | 'ctr' | 'gasto';

const PERIODOS = [{ v: 'hoy', l: 'Hoy' }, { v: 'ayer', l: 'Ayer' }, { v: '7d', l: '7 días' }, { v: '14d', l: '14 días' }, { v: '30d', l: '30 días' }];
const ORDENES: Array<{ v: Orden; l: string }> = [{ v: 'roas', l: 'ROAS' }, { v: 'cpa', l: 'CPA' }, { v: 'ctr', l: 'CTR' }, { v: 'gasto', l: 'Gasto' }];
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const sel = 'rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100';

const calc = (g: number, c: number, f: number, i: number, k: number) => ({
  cpa: c > 0 ? g / c : null, roas: g > 0 && f > 0 ? f / g : null, ctr: i > 0 ? (k / i) * 100 : null,
});

function ordenar<T extends { gasto: number; roas: number | null; cpa: number | null; ctr: number | null }>(l: T[], o: Orden) {
  return [...l].sort((a, b) => {
    if (o === 'gasto') return b.gasto - a.gasto;
    const x = a[o], y = b[o];
    if (x === null && y === null) return b.gasto - a.gasto;
    if (x === null) return 1;
    if (y === null) return -1;
    return o === 'cpa' ? x - y : y - x;
  });
}

export default function TiktokPage() {
  const [periodo, setPeriodo] = useState('7d');
  const [orden, setOrden] = useState<Orden>('roas');
  const [vista, setVista] = useState<'anuncios' | 'campanas'>('campanas');
  const [res, setRes] = useState<{ p: string; anuncios: Anuncio[]; actualizado: string | null; error: string }>({ p: '', anuncios: [], actualizado: null, error: '' });
  const cargando = res.p !== periodo;

  useEffect(() => {
    const p = periodo;
    fetch(`/api/anuncios/tiktok?periodo=${p}`).then((r) => r.json())
      .then((j) => setRes({ p, anuncios: j.anuncios ?? [], actualizado: j.actualizado ?? null, error: j.error ?? '' }))
      .catch((e) => setRes({ p, anuncios: [], actualizado: null, error: String(e) }));
  }, [periodo]);

  const anuncios = cargando ? [] : res.anuncios;
  const porCamp = new Map<string, { nombre: string; gasto: number; compras: number; facturacion: number; impresiones: number; clics: number; n: number }>();
  for (const a of anuncios) {
    const c = porCamp.get(a.campana) ?? { nombre: a.campana, gasto: 0, compras: 0, facturacion: 0, impresiones: 0, clics: 0, n: 0 };
    c.gasto += a.gasto; c.compras += a.compras; c.facturacion += a.facturacion; c.impresiones += a.impresiones; c.clics += a.clics; c.n++;
    porCamp.set(a.campana, c);
  }
  const campanas = [...porCamp.values()].map((c) => ({ ...c, ...calc(c.gasto, c.compras, c.facturacion, c.impresiones, c.clics) }));
  const tot = anuncios.reduce((s, a) => ({ g: s.g + a.gasto, c: s.c + a.compras, f: s.f + a.facturacion, i: s.i + a.impresiones, k: s.k + a.clics }), { g: 0, c: 0, f: 0, i: 0, k: 0 });
  const t = calc(tot.g, tot.c, tot.f, tot.i, tot.k);
  const filas = vista === 'campanas'
    ? ordenar(campanas, orden).map((c) => ({ key: c.nombre, titulo: c.nombre, sub: `${c.n} anuncio(s)`, ...c }))
    : ordenar(anuncios, orden).map((a) => ({ key: a.id, titulo: a.nombre, sub: `${a.campana} · ${a.conjunto}`, ...a }));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="TikTok Ads" subtitle="Rendimiento · cuenta ANDOMAT 611 SRL" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />

        <div className="flex flex-wrap gap-2 items-center">
          <select className={sel} value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <div className="flex gap-1 rounded-lg bg-slate-900 border border-slate-800 p-1 text-sm">
            {(['campanas', 'anuncios'] as const).map((v) => (
              <button key={v} onClick={() => setVista(v)} className={`rounded-md px-3 py-1 ${vista === v ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-400'}`}>
                {v === 'campanas' ? 'Por campaña' : 'Por anuncio'}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-400 ml-auto">Ordenar:</span>
          {ORDENES.map((o) => (
            <button key={o.v} onClick={() => setOrden(o.v)}
              className={`rounded-full px-3 py-1 text-sm ${orden === o.v ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-slate-900 text-slate-400 hover:text-slate-100'}`}>
              {o.l}
            </button>
          ))}
        </div>

        {!cargando && !res.error && anuncios.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
            {[['Gasto', $(tot.g)], ['Compras', String(tot.c)], ['ROAS', t.roas ? `${t.roas.toFixed(2)}x` : '—'], ['CPA', t.cpa ? $(t.cpa) : '—'], ['CTR', t.ctr ? `${t.ctr.toFixed(2)}%` : '—']].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2"><p className="text-xs text-slate-500">{l}</p><p className="font-semibold">{v}</p></div>
            ))}
          </div>
        )}

        {cargando && <p className="text-sm text-slate-400">Cargando…</p>}
        {res.error && <p className="text-sm text-rose-400">{res.error}</p>}
        {!cargando && !res.error && anuncios.length === 0 && <p className="text-sm text-slate-500">No hay anuncios con gasto en este período.</p>}

        <div className="space-y-2">
          {filas.map((a, i) => (
            <div key={a.key} className="rounded-xl border border-slate-800 bg-slate-900 p-3 flex gap-3 items-center">
              <span className={`w-6 text-center text-sm font-semibold ${i < 3 ? 'text-emerald-300' : 'text-slate-500'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{a.titulo}</p>
                <p className="text-xs text-slate-500 truncate">{a.sub}</p>
                <p className="text-xs text-slate-500 mt-0.5">Gasto {$(a.gasto)} · {a.compras} compras · Fact. {$(a.facturacion)}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-4 text-right text-sm flex-shrink-0">
                {(['roas', 'cpa', 'ctr'] as const).map((k) => (
                  <div key={k} className={orden === k ? 'text-emerald-300' : 'text-slate-300'}>
                    <p className="text-[10px] uppercase text-slate-500">{k}</p>
                    <p className="font-semibold tabular-nums">{a[k] === null ? '—' : k === 'roas' ? `${a[k]!.toFixed(2)}x` : k === 'cpa' ? $(a[k]!) : `${a[k]!.toFixed(2)}%`}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          Datos de la API de TikTok (compras y facturación según el píxel de TikTok), en pesos al dólar blue; se actualizan cada hora
          {res.actualizado ? ` (última: ${new Date(res.actualizado).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })})` : ''}.
          Para crear o pausar campañas desde acá hay que sumar el permiso de gestión de campañas a la app de TikTok.
        </p>
      </main>
    </div>
  );
}
