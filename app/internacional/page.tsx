'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';
import type { EnvioSuelto, Venta } from '@/lib/internacional';

// Rentabilidad de las ventas internacionales: lo cobrado en Stripe − comisión − envío de Leo (FedEx) − costo de
// productos. Separa la página (mateandoshop.com) de las ventas aparte (links de pago manuales).
type Data = { ventas: Venta[]; sueltos: EnvioSuelto[]; dolarHoy: number; actualizado: string };

const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');
const usd = (n: number) => `US$ ${n.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
const pct = (n: number | null) => (n == null ? '–' : `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })}%`);
const caja = 'bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5';
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(2, 4)}`;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nomMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

function resumen(vs: Venta[]) {
  const cobrado = vs.reduce((s, v) => s + v.cobradoArs, 0);
  const comision = vs.reduce((s, v) => s + v.comisionArs, 0);
  const envio = vs.reduce((s, v) => s + (v.envioArs ?? 0), 0);
  const costo = vs.reduce((s, v) => s + (v.costoArs ?? 0), 0);
  const completas = vs.filter((v) => v.gananciaArs != null);
  const gan = completas.reduce((s, v) => s + v.gananciaArs!, 0);
  const cobC = completas.reduce((s, v) => s + v.cobradoArs, 0);
  return {
    pedidos: vs.length, cobradoUsd: vs.reduce((s, v) => s + v.cobradoUsd - v.devueltoUsd, 0), cobrado, comision, envio, costo,
    // Ganancia antes de mercadería: siempre se puede calcular (si falta el envío cuenta 0)
    antesMerca: cobrado - comision - envio,
    completas: completas.length, gan, margen: cobC ? gan / cobC : null,
    sinEnvio: vs.filter((v) => v.envioArs == null).length,
    sinCosto: vs.filter((v) => v.costoArs == null).length,
  };
}

export default function Page() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [origen, setOrigen] = useState<'todos' | 'pagina' | 'aparte'>('todos');
  const [mes, setMes] = useState('todo');
  useEffect(() => {
    fetch('/api/internacional').then((r) => r.json()).then((x) => (x.error ? setErr(x.error) : setD(x))).catch((e) => setErr(String(e)));
  }, []);

  const meses = useMemo(() => [...new Set((d?.ventas ?? []).map((v) => v.fecha.slice(0, 7)))].sort().reverse(), [d]);
  const filtradas = useMemo(
    () => (d?.ventas ?? []).filter((v) => (origen === 'todos' || v.origen === origen) && (mes === 'todo' || v.fecha.startsWith(mes))),
    [d, origen, mes],
  );
  const r = resumen(filtradas);
  const porMes = useMemo(
    () => meses.map((m) => ({ m, ...resumen((d?.ventas ?? []).filter((v) => v.fecha.startsWith(m) && (origen === 'todos' || v.origen === origen))) })),
    [d, meses, origen],
  );
  const sueltos = (d?.sueltos ?? []).filter((s) => mes === 'todo' || s.fecha.startsWith(mes));
  const paises = useMemo(() => {
    const nom = new Intl.DisplayNames(['es'], { type: 'region' });
    const m = new Map<string, Venta[]>();
    for (const v of filtradas) { const k = v.pais || '—'; m.set(k, [...(m.get(k) ?? []), v]); }
    return [...m].map(([k, vs]) => {
      let n = k;
      try { if (/^[A-Z]{2}$/.test(k)) n = nom.of(k) ?? k; } catch { /* código raro */ }
      return { k, n, ...resumen(vs) };
    }).sort((a, b) => b.cobradoUsd - a.cobradoUsd);
  }, [filtradas]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Rentabilidad Internacional" subtitle="mateandoshop.com + ventas aparte · Stripe − comisión − envío Leo − mercadería" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="flex gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1 text-sm">
            {([['todos', 'Todo'], ['pagina', 'Página'], ['aparte', 'Ventas aparte']] as const).map(([id, l]) => (
              <button key={id} onClick={() => setOrigen(id)}
                className={`px-3 py-1.5 rounded-md whitespace-nowrap ${origen === id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>{l}</button>
            ))}
          </div>
          <select value={mes} onChange={(e) => setMes(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-sm text-slate-200">
            <option value="todo">Desde mar 25</option>
            {meses.map((m) => <option key={m} value={m}>{nomMes(m)}</option>)}
          </select>
        </div>

        {err && <div className={`${caja} text-rose-300 text-sm`}>Error: {err}</div>}
        {!d && !err && <div className={`${caja} text-slate-400 text-sm`}>Cargando Stripe, Shopify y la planilla de Leo…</div>}

        {d && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ['Pedidos', String(r.pedidos), usd(r.cobradoUsd)],
                ['Cobrado', fmt(r.cobrado), `dólar blue compra del mes`],
                ['Queda antes de mercadería', fmt(r.antesMerca), r.cobrado ? `${pct(r.antesMerca / r.cobrado)} · cobrado − Stripe − envío` : ''],
                ['Ganancia', r.completas ? fmt(r.gan) : '–', r.completas ? `${pct(r.margen)} en ${r.completas} pedidos con todo cargado` : 'falta costo de productos'],
              ].map(([t, v, n]) => (
                <div key={t} className={caja}>
                  <div className="text-xs text-slate-500">{t}</div>
                  <div className={`text-xl font-semibold mt-1 ${t === 'Ganancia' && r.completas ? (r.gan < 0 ? 'text-rose-400' : 'text-emerald-300') : ''}`}>{v}</div>
                  {n && <div className="text-xs mt-1 text-slate-500">{n}</div>}
                </div>
              ))}
            </div>

            <div className={caja}>
              <h2 className="text-sm font-semibold mb-3">De lo cobrado a lo que queda</h2>
              <table className="w-full text-sm"><tbody>
                {[
                  ['Cobrado (Stripe, sin devoluciones)', r.cobrado, ''],
                  ['Comisión Stripe', -r.comision, ''],
                  ['Envío FedEx (Leo)', -r.envio, r.sinEnvio ? `${r.sinEnvio} pedidos sin envío encontrado en la planilla` : ''],
                  ['Mercadería', -r.costo, r.sinCosto ? `${r.sinCosto} pedidos sin costo: Shopify da productos solo de los últimos 60 días, o falta el costo` : ''],
                ].map(([t, m, n]) => (
                  <tr key={t as string} className="border-t border-slate-800 first:border-0">
                    <td className="py-2 pr-2">{t}{n && <div className="text-xs text-amber-300/80">{n}</div>}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(m as number)}</td>
                    <td className="py-2 pl-3 text-right text-xs text-slate-500 w-14">{r.cobrado ? pct((m as number) / r.cobrado) : ''}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-700 font-semibold">
                  <td className="py-2">Queda<div className="text-xs font-normal text-slate-500">los pedidos sin costo de mercadería lo inflan</div></td>
                  <td className="py-2 text-right tabular-nums text-emerald-300">{fmt(r.antesMerca - r.costo)}</td>
                  <td className="py-2 pl-3 text-right text-xs text-slate-400">{r.cobrado ? pct((r.antesMerca - r.costo) / r.cobrado) : ''}</td>
                </tr>
              </tbody></table>
            </div>

            {mes === 'todo' && (
              <div className={caja}>
                <h2 className="text-sm font-semibold mb-3">Por mes</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-500 text-left">
                      <th className="pb-2 font-normal">Mes</th><th className="pb-2 font-normal text-right">Pedidos</th>
                      <th className="pb-2 font-normal text-right">Cobrado</th><th className="pb-2 font-normal text-right hidden sm:table-cell">Envíos</th>
                      <th className="pb-2 font-normal text-right">Antes de merca.</th>
                    </tr></thead>
                    <tbody>
                      {porMes.map((x) => (
                        <tr key={x.m} className="border-t border-slate-800 cursor-pointer hover:bg-slate-800/40" onClick={() => setMes(x.m)}>
                          <td className="py-1.5">{nomMes(x.m)}</td>
                          <td className="py-1.5 text-right tabular-nums">{x.pedidos}</td>
                          <td className="py-1.5 text-right tabular-nums">{fmt(x.cobrado)}<div className="text-xs text-slate-500">{usd(x.cobradoUsd)}</div></td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400 hidden sm:table-cell">{fmt(x.envio)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${x.antesMerca < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(x.antesMerca)}<div className="text-xs text-slate-500">{x.cobrado ? pct(x.antesMerca / x.cobrado) : ''}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {!!paises.length && (
              <div className={caja}>
                <h2 className="text-sm font-semibold mb-3">Ranking de países</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-500 text-left">
                      <th className="pb-2 font-normal">País</th><th className="pb-2 font-normal text-right">Pedidos</th>
                      <th className="pb-2 font-normal text-right">Cobrado</th><th className="pb-2 font-normal text-right hidden sm:table-cell">Envío prom.</th>
                      <th className="pb-2 font-normal text-right">Antes de merca.</th>
                    </tr></thead>
                    <tbody>
                      {paises.map((p, i) => {
                        const conEnvio = p.pedidos - p.sinEnvio;
                        return (
                          <tr key={p.k} className="border-t border-slate-800">
                            <td className="py-1.5"><span className="text-slate-500 tabular-nums mr-2">{i + 1}</span>{p.n}</td>
                            <td className="py-1.5 text-right tabular-nums">{p.pedidos}</td>
                            <td className="py-1.5 text-right tabular-nums">{usd(p.cobradoUsd)}<div className="text-xs text-slate-500">{r.cobradoUsd ? pct(p.cobradoUsd / r.cobradoUsd) : ''} del total</div></td>
                            <td className="py-1.5 text-right tabular-nums text-slate-400 hidden sm:table-cell">{conEnvio ? fmt(p.envio / conEnvio) : '–'}</td>
                            <td className={`py-1.5 text-right tabular-nums ${p.antesMerca < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>{fmt(p.antesMerca)}<div className="text-xs text-slate-500">{p.cobrado ? pct(p.antesMerca / p.cobrado) : ''}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className={caja}>
              <h2 className="text-sm font-semibold mb-3">Pedidos</h2>
              {!filtradas.length ? <div className="text-sm text-slate-500">Sin pedidos.</div> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-slate-500 text-left">
                      <th className="pb-2 font-normal">Pedido</th><th className="pb-2 font-normal text-right">Cobrado</th>
                      <th className="pb-2 font-normal text-right hidden sm:table-cell">Envío</th><th className="pb-2 font-normal text-right hidden sm:table-cell">Merca.</th>
                      <th className="pb-2 font-normal text-right">Ganancia</th>
                    </tr></thead>
                    <tbody>
                      {filtradas.map((v) => (
                        <tr key={v.id} className="border-t border-slate-800 align-top">
                          <td className="py-1.5 pr-2">
                            <span className="text-slate-100">{v.cliente}</span> <span className="text-xs text-slate-500">{ddmm(v.fecha)} · {v.pais}{v.pedido ? ` · ${v.pedido}` : ''}</span>
                            {v.origen === 'aparte' && <span className="ml-1 text-[10px] uppercase tracking-wide rounded bg-sky-500/15 text-sky-300 px-1.5 py-0.5">aparte</span>}
                            {!!v.productos.length && <div className="text-xs text-slate-500">{v.productos.map((p) => `${p.cantidad > 1 ? `${p.cantidad}× ` : ''}${p.titulo.toLowerCase()}${p.costo == null ? ' (sin costo)' : p.supuesto ? ' (supuesto)' : ''}`).join(' · ')}</div>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">{usd(v.cobradoUsd - v.devueltoUsd)}<div className="text-xs text-slate-500">{fmt(v.cobradoArs)}</div></td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400 hidden sm:table-cell">{v.envioArs == null ? <span className="text-amber-300 text-xs">no está</span> : fmt(v.envioArs)}{v.envioRecargo && <div className="text-xs text-rose-300">recargo</div>}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-400 hidden sm:table-cell">{v.costoArs == null ? <span className="text-amber-300 text-xs">sin dato</span> : fmt(v.costoArs)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${v.gananciaArs == null ? 'text-slate-500' : v.gananciaArs < 0 ? 'text-rose-400' : 'text-emerald-300'}`}>
                            {v.gananciaArs == null ? '–' : fmt(v.gananciaArs)}
                            {v.gananciaArs != null && <div className="text-xs text-slate-500">{pct(v.gananciaArs / v.cobradoArs)}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {!!sueltos.length && origen !== 'pagina' && (
              <div className={caja}>
                <h2 className="text-sm font-semibold mb-1">Envíos de Leo sin cobro en Stripe</h2>
                <p className="text-xs text-slate-500 mb-3">Ventas cobradas por otro lado (transferencia, mayorista), muestras o envíos que no pude cruzar por nombre. Total {fmt(sueltos.reduce((s, x) => s + x.envioArs, 0))}.</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm"><tbody>
                    {sueltos.map((s, i) => (
                      <tr key={i} className="border-t border-slate-800 first:border-0">
                        <td className="py-1.5 pr-2">{s.cliente || '—'} <span className="text-xs text-slate-500">{ddmm(s.fecha)} · {s.pais}{s.pedido && !/china/i.test(s.pedido) ? ` · ${s.pedido}` : ''}</span>
                          {s.motivo && <span className="ml-1 text-[10px] uppercase tracking-wide rounded bg-violet-500/15 text-violet-300 px-1.5 py-0.5">{s.motivo}</span>}</td>
                        <td className="py-1.5 text-right tabular-nums text-slate-400">{fmt(s.envioArs)}</td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">Dólar blue compra: promedio del mes de cada venta (hoy {fmt(d.dolarHoy)}). La tienda tiene envío gratis: el envío de Leo es costo nuestro.</p>
          </>
        )}
      </main>
    </div>
  );
}
