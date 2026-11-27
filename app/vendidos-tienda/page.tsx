'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';

// Productos vendidos en Empretienda (pedido de Nacho): como Métricas → productos de Empretienda, con miniatura,
// ordenados por compras o por volumen, con Hoy / Ayer / 7 días / Mes / fechas a elección.

type Variante = { v: string; unidades: number; volumen: number };
type Producto = { id: string; producto: string; foto: string | null; link: string | null; unidades: number; volumen: number; pedidos: number; variantes: Variante[] };
type Data = { desde: string; hasta: string; actualizado: string; pedidos: number; unidades: number; volumen: number; productos: Producto[]; error?: string };

const hoyAR = (menos = 0) => new Date(Date.now() - 3 * 3600e3 - menos * 864e5).toISOString().slice(0, 10);
const PERIODOS = [
  { id: 'hoy', label: 'Hoy', rango: () => [hoyAR(), hoyAR()] },
  { id: 'ayer', label: 'Ayer', rango: () => [hoyAR(1), hoyAR(1)] },
  { id: 'semana', label: '7 días', rango: () => [hoyAR(6), hoyAR()] },
  { id: 'mes', label: 'Mes', rango: () => [`${hoyAR().slice(0, 8)}01`, hoyAR()] },
  { id: 'fechas', label: 'Elegir fechas', rango: () => [] as string[] },
] as const;
const CANALES = [
  { id: 'todos', label: 'Todo' },
  { id: 'online', label: 'Tienda online' },
  { id: 'local', label: 'Local (hasta 8-nov)' },
] as const;
const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const caja = 'bg-slate-900 rounded-2xl border border-slate-800';
const pill = (on: boolean) => `rounded-full px-3 py-1.5 text-sm ${on ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30' : 'bg-slate-900 text-slate-400 hover:text-slate-100'}`;

export default function VendidosTienda() {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]['id']>('hoy');
  const [desdeP, setDesdeP] = useState(hoyAR(6));
  const [hastaP, setHastaP] = useState(hoyAR());
  const [canal, setCanal] = useState<(typeof CANALES)[number]['id']>('todos');
  const [orden, setOrden] = useState<'compras' | 'volumen'>('compras');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [res, setRes] = useState<{ clave: string; data: Data | null }>({ clave: '', data: null });

  const [desde, hasta] = periodo === 'fechas' ? [desdeP, hastaP] : PERIODOS.find((p) => p.id === periodo)!.rango();
  const clave = `${desde}|${hasta}|${canal}`;
  const cargando = res.clave !== clave;
  const data = cargando ? null : res.data;

  useEffect(() => {
    if (!desde || !hasta || desde > hasta) return;
    const k = `${desde}|${hasta}|${canal}`;
    fetch(`/api/tienda/vendidos?desde=${desde}&hasta=${hasta}&canal=${canal}`).then((r) => r.json())
      .then((j) => setRes({ clave: k, data: j }))
      .catch((e) => setRes({ clave: k, data: { error: String(e) } as Data }));
  }, [desde, hasta, canal]);

  const lista = [...(data?.productos ?? [])].sort((a, b) =>
    orden === 'compras' ? b.unidades - a.unidades || b.volumen - a.volumen : b.volumen - a.volumen || b.unidades - a.unidades);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Vendidos Empretienda" subtitle="Productos vendidos en la tienda" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {PERIODOS.map((p) => <button key={p.id} className={pill(periodo === p.id)} onClick={() => setPeriodo(p.id)}>{p.label}</button>)}
        </div>
        {periodo === 'fechas' && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-400">Desde</span>
            <input type="date" className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2" value={desdeP} max={hastaP} onChange={(e) => setDesdeP(e.target.value)} />
            <span className="text-slate-400">hasta</span>
            <input type="date" className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2" value={hastaP} min={desdeP} max={hoyAR()} onChange={(e) => setHastaP(e.target.value)} />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {CANALES.map((c) => <button key={c.id} className={pill(canal === c.id)} onClick={() => setCanal(c.id)}>{c.label}</button>)}
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          {[['Pedidos', data ? String(data.pedidos) : '…'], ['Unidades', data ? String(data.unidades) : '…'], ['Volumen', data ? $(data.volumen) : '…']].map(([l, v]) => (
            <div key={l} className={`${caja} px-3 py-2`}><p className="text-xs text-slate-500">{l}</p><p className="font-semibold tabular-nums">{v}</p></div>
          ))}
        </div>

        <div className={`${caja} overflow-hidden`}>
          <div className="grid grid-cols-2 text-sm font-semibold border-b border-slate-800">
            {(['compras', 'volumen'] as const).map((o) => (
              <button key={o} onClick={() => setOrden(o)}
                className={`py-3 ${orden === o ? 'text-emerald-300 border-b-2 border-emerald-400' : 'text-slate-400 hover:text-slate-100'}`}>
                Ordenados por {o}
              </button>
            ))}
          </div>
          {cargando && <p className="p-4 text-sm text-slate-400">Cargando…</p>}
          {data?.error && <p className="p-4 text-sm text-rose-400">{data.error}</p>}
          {!cargando && !data?.error && lista.length === 0 && <p className="p-4 text-sm text-slate-500">No hay ventas en este período.</p>}
          <ul className="divide-y divide-slate-800">
            {lista.map((p, i) => {
              const conVar = p.variantes.length > 1 || (p.variantes[0]?.v ?? '') !== '';
              return (
                <li key={p.id || p.producto} className="p-3">
                  <button className="w-full flex items-center gap-3 text-left" onClick={() => conVar && setAbierto(abierto === p.producto ? null : p.producto)}>
                    <span className={`w-6 text-center text-sm font-semibold ${i < 3 ? 'text-emerald-300' : 'text-slate-500'}`}>{i + 1}</span>
                    <div className="w-14 h-14 sm:w-16 sm:h-16 flex-shrink-0 rounded-full overflow-hidden bg-slate-950">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {p.foto && <img src={p.foto} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words">{p.producto}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{p.pedidos} pedido{p.pedidos === 1 ? '' : 's'}{conVar ? ` · ${p.variantes.length} variante${p.variantes.length === 1 ? '' : 's'} ${abierto === p.producto ? '▴' : '▾'}` : ''}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold tabular-nums ${orden === 'compras' ? 'text-emerald-300' : ''}`}>{p.unidades} u.</p>
                      <p className={`text-xs tabular-nums ${orden === 'volumen' ? 'text-emerald-300 font-semibold' : 'text-slate-400'}`}>{$(p.volumen)}</p>
                    </div>
                  </button>
                  {abierto === p.producto && (
                    <ul className="mt-2 ml-9 sm:ml-[6.5rem] space-y-1">
                      {p.variantes.map((v) => (
                        <li key={v.v} className="flex justify-between gap-3 text-xs text-slate-400">
                          <span className="break-words">{v.v || 'Sin variante'}</span>
                          <span className="tabular-nums flex-shrink-0">{v.unidades} u. · {$(v.volumen)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="text-xs text-slate-500">
          Ventas pagas de Empretienda. Volumen = cantidad × precio (con IVA, sin envío). Se actualiza cada hora
          {data?.actualizado ? ` · último dato ${new Date(data.actualizado).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.
        </p>
      </main>
    </div>
  );
}
