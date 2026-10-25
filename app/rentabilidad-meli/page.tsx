'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppHeader from '../components/AppHeader';
import Ventas, { type VentaFila } from './Ventas';
import { Tarjeta, nomDia, num, porc } from '../components/TarjetaKpi';
import { describirAdicional, type CostoAdicional } from '@/lib/costosAdicionales';

type Totales = {
  ordenes: number; unidades: number; venta: number; comision: number; envio_ml: number; envio_flex: number;
  impuestos: number; costo: number; neto: number;
};
type Ratios = { margen: number | null; roas: number | null; acos: number | null; tacos: number | null; roasMl: number | null; acosMl: number | null; tacosMl: number | null };
type Dia = Totales & Ratios & { fecha: string; pauta: number; adicionales: number; ganancia: number; gananciaFinal: number };
type Total = Totales & Ratios & {
  pauta: number; atribuidas: number; otros: (CostoAdicional & { total: number })[]; adicionales: number; ganancia: number; gananciaFinal: number;
  sinCosto: number; flexEstimados: number;
};
type Data = {
  desde: string;
  hasta: string;
  actualizado: string;
  total: Total;
  anterior: (Total & { desde: string; hasta: string }) | null;
  serie: Dia[];
  dias: Dia[];
  ventas: VentaFila[];
  productos: (Totales & { item_id: string; titulo: string; foto: string | null; sinCosto: boolean })[];
  logisticas: (Totales & { logistica: string })[];
};

const PERIODOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'ayer', label: 'Ayer' },
  { id: 'semana', label: '7 días' },
  { id: 'mes', label: 'Mes' },
  { id: 'mesant', label: 'Mes anterior' },
] as const;
type PeriodoId = (typeof PERIODOS)[number]['id'];

const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-AR');
const pct = (n: number, de: number) => (de ? `${((n / de) * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%` : '–');
const LOGISTICA: Record<string, string> = { full: 'Full', flex: 'Flex', colecta: 'Colecta', agencia: 'Agencia', correo: 'Correo', 'sin envío': 'Sin envío' };
const color = (n: number) => (n < 0 ? 'text-rose-400' : 'text-emerald-300');
// La miniatura de ML termina en -I.jpg; -O.jpg es la misma foto más grande.
const fotoGrande = (url: string) => url.replace(/-[A-Z]\.(jpg|jpeg|png|webp)$/i, '-O.$1');

export default function RentabilidadMeli() {
  const [periodo, setPeriodo] = useState<PeriodoId>('mes');
  const [res, setRes] = useState<{ periodo: PeriodoId; data?: Data; err?: string } | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const [zoom, setZoom] = useState<{ src: string; titulo: string } | null>(null);

  useEffect(() => {
    if (!zoom) return;
    const cerrar = (e: KeyboardEvent) => e.key === 'Escape' && setZoom(null);
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [zoom]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/ml/rentabilidad?periodo=${periodo}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { periodo, err: d.error } : { periodo, data: d }))
      .catch((e) => vivo && setRes({ periodo, err: String(e) }));
    return () => { vivo = false; };
  }, [periodo]);

  const d = res?.periodo === periodo ? res.data : undefined;
  const err = res?.periodo === periodo ? res.err : '';
  const t = d?.total;
  const a = d?.anterior;
  const serie = (f: (x: Dia) => number | null) => (d?.serie ?? []).map((x) => ({ fecha: x.fecha, v: f(x) }));

  const cascada = t
    ? [
        { nombre: 'Venta sin IVA', valor: t.venta, total: true },
        { nombre: 'Comisión de Mercado Libre', valor: -t.comision },
        { nombre: 'Envíos de ML', valor: -t.envio_ml, nota: 'Full y Colecta: lo que cobra ML. Flex: ML no cobra y te paga la bonificación Flex y el envío que paga el comprador (se resta)' },
        { nombre: 'Envíos Flex propios', valor: -t.envio_flex, nota: 'CABA $3.400 · cordón 1 $5.200 · 2 $6.500 · 3 $8.000' },
        { nombre: 'Impuestos (5%)', valor: -t.impuestos },
        { nombre: 'Costo de producto', valor: -t.costo },
        { nombre: 'Neto antes de publicidad', valor: t.neto, total: true },
        { nombre: 'Publicidad ML Ads', valor: -t.pauta },
        { nombre: 'Ganancia', valor: t.ganancia, total: true, nota: 'La misma cuenta que la Ganancia de Mercado Libre en Escalafy' },
        ...t.otros.map((c) => ({ nombre: c.nombre, valor: -c.total, nota: describirAdicional(c), total: false })),
        { nombre: 'Ganancia final', valor: t.gananciaFinal, total: true, nota: 'Después de los costos adicionales (Escalafy los resta solo en el total de la empresa)' },
      ]
    : [];

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Rentabilidad Mercado Libre" subtitle="Margen por orden con las reglas de Escalafy · importes sin IVA" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-900 overflow-x-auto max-w-full">
            {PERIODOS.map((p) => (
              <button key={p.id} onClick={() => setPeriodo(p.id)}
                className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${periodo === p.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {d?.actualizado && (
              <span className="text-xs text-slate-500">
                Actualizado {new Date(d.actualizado).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Link href="/rentabilidad-meli/costos" className="text-sm rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-200 hover:border-emerald-600 hover:text-emerald-300">
              Cargar costos
            </Link>
          </div>
        </div>

        {err && <p className="text-sm text-rose-400">No se pudo leer la rentabilidad: {err}</p>}
        {!d && !err && <p className="text-sm text-slate-500">Cargando…</p>}

        {t && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tarjeta titulo="Ventas" valor={t.ordenes.toLocaleString('es-AR')} actual={t.ordenes} anterior={a?.ordenes}
                detalle={`${t.unidades.toLocaleString('es-AR')} unidades`} puntos={serie((x) => x.ordenes)} formato={(n) => n.toLocaleString('es-AR')} />
              <Tarjeta titulo="Facturación sin IVA" valor={fmt(t.venta)} actual={t.venta} anterior={a?.venta}
                puntos={serie((x) => x.venta)} formato={fmt} />
              <Tarjeta titulo="Margen de ganancia" valor={t.margen == null ? '–' : porc(t.margen)} actual={t.margen} anterior={a?.margen} enPuntos
                puntos={serie((x) => x.margen)} formato={porc} />
              <Tarjeta titulo="Ganancia" valor={fmt(t.ganancia)} actual={t.ganancia} anterior={a?.ganancia}
                detalle={`Final ${fmt(t.gananciaFinal)} (con costos adicionales)`} puntos={serie((x) => x.ganancia)} formato={fmt} />
              <Tarjeta titulo="Inversión publicitaria" valor={fmt(t.pauta)} actual={t.pauta} anterior={a?.pauta} mejorSiSube={false}
                detalle="ML Ads" puntos={serie((x) => x.pauta)} formato={fmt} />
              <Tarjeta titulo="ROAS" valor={t.roasMl == null ? '–' : `${num(t.roasMl)}x`} actual={t.roasMl} anterior={a?.roasMl}
                detalle={t.roas == null ? undefined : `Sin IVA (Escalafy): ${num(t.roas)}`} puntos={serie((x) => x.roasMl)} formato={(n) => `${num(n)}x`} />
              <Tarjeta titulo="ACOS" valor={t.acosMl == null ? '–' : porc(t.acosMl)} actual={t.acosMl} anterior={a?.acosMl} enPuntos mejorSiSube={false}
                detalle={t.acos == null ? 'Inversión ÷ ventas por publicidad' : `Sin IVA (Escalafy): ${porc(t.acos)}`} puntos={serie((x) => x.acosMl)} formato={porc} />
              <Tarjeta titulo="TACOS" valor={t.tacosMl == null ? '–' : porc(t.tacosMl)} actual={t.tacosMl} anterior={a?.tacosMl} enPuntos mejorSiSube={false}
                detalle={t.tacos == null ? 'Inversión ÷ facturación total' : `Sin IVA (Escalafy): ${porc(t.tacos)}`} puntos={serie((x) => x.tacosMl)} formato={porc} />
            </div>
            <p className="text-[11px] text-slate-500 -mt-1">
              ROAS, ACOS y TACOS como el panel de ML Ads (con IVA; TACOS = inversión ÷ ventas por publicidad + orgánicas de las publicaciones en campaña). Abajo, sin IVA como Escalafy.
              {d.anterior ? ` Variación contra ${nomDia(d.anterior.desde)} – ${nomDia(d.anterior.hasta)}.` : ' Sin período anterior cargado para comparar.'}
            </p>

            {(t.sinCosto > 0 || t.flexEstimados > 0) && (
              <div className="rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 space-y-1">
                {t.sinCosto > 0 && (
                  <p>
                    ⚠️ {t.sinCosto} unidades vendidas sin costo cargado: cuentan costo $0 y el margen sale inflado.{' '}
                    <Link href="/rentabilidad-meli/costos" className="underline hover:text-amber-100">Cargar costos</Link>
                  </p>
                )}
                {t.flexEstimados > 0 && <p>📍 {t.flexEstimados} envíos Flex a un código postal sin cordón conocido: se usó el cordón del CP más cercano.</p>}
              </div>
            )}

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">De la venta a la ganancia</h2>
              <table className="w-full text-sm">
                <tbody>
                  {cascada.map((c) => (
                    <tr key={c.nombre} className={`border-t border-slate-800/60 ${c.total ? 'font-semibold' : ''}`}>
                      <td className="py-2 pr-2">
                        {c.nombre}
                        {c.nota && <span className="block text-[11px] font-normal text-slate-500">{c.nota}</span>}
                      </td>
                      <td className={`py-2 text-right tabular-nums ${c.total ? color(c.valor) : 'text-slate-300'}`}>{fmt(c.valor)}</td>
                      <td className="py-2 pl-3 text-right tabular-nums text-slate-500 w-16">{pct(c.valor, t.venta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-3">Por tipo de envío</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="py-2">Envío</th>
                      <th className="text-right">Pedidos</th>
                      <th className="text-right pl-3">Venta</th>
                      <th className="text-right pl-3">Envío</th>
                      <th className="text-right pl-3">Neto</th>
                      <th className="text-right pl-3">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.logisticas.map((l) => (
                      <tr key={l.logistica} className="border-t border-slate-800/60 tabular-nums">
                        <td className="py-2">{LOGISTICA[l.logistica] ?? l.logistica}</td>
                        <td className="text-right">{l.ordenes.toLocaleString('es-AR')}</td>
                        <td className="text-right pl-3">{fmt(l.venta)}</td>
                        <td className="text-right pl-3 text-slate-400">{fmt(l.envio_ml + l.envio_flex)}</td>
                        <td className={`text-right pl-3 ${color(l.neto)}`}>{fmt(l.neto)}</td>
                        <td className="text-right pl-3 text-slate-400">{pct(l.neto, l.venta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {d.dias.length > 1 && (
              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-200 mb-3">Por día</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="py-2">Día</th>
                        <th className="text-right">Venta</th>
                        <th className="text-right pl-3">Neto</th>
                        <th className="text-right pl-3 hidden sm:table-cell">Publicidad</th>
                        <th className="text-right pl-3">Ganancia</th>
                        <th className="text-right pl-3 hidden sm:table-cell">Margen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.dias.map((x) => (
                        <tr key={x.fecha} className="border-t border-slate-800/60 tabular-nums">
                          <td className="py-2 whitespace-nowrap">{nomDia(x.fecha)}</td>
                          <td className="text-right">{fmt(x.venta)}</td>
                          <td className="text-right pl-3">{fmt(x.neto)}</td>
                          <td className="text-right pl-3 text-slate-400 hidden sm:table-cell">{fmt(x.pauta)}</td>
                          <td className={`text-right pl-3 ${color(x.ganancia)}`}>{fmt(x.ganancia)}</td>
                          <td className="text-right pl-3 text-slate-400 hidden sm:table-cell">{pct(x.ganancia, x.venta)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200 mb-1">Por publicación</h2>
              <p className="text-xs text-slate-500 mb-3">Neto antes de publicidad (la pauta no se reparte por publicación)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="py-2">Publicación</th>
                      <th className="text-right pl-3">U.</th>
                      <th className="text-right pl-3">Venta</th>
                      <th className="text-right pl-3 hidden sm:table-cell">Costo</th>
                      <th className="text-right pl-3">Neto</th>
                      <th className="text-right pl-3">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(verTodos ? d.productos : d.productos.slice(0, 25)).map((p) => (
                      <tr key={p.item_id} className="border-t border-slate-800/60 tabular-nums">
                        <td className="py-2 pr-2 max-w-[13rem] sm:max-w-md">
                          <div className="flex items-center gap-3 min-w-0">
                            {p.foto ? (
                              <button onClick={() => setZoom({ src: fotoGrande(p.foto!), titulo: p.titulo })} title="Ver foto"
                                className="shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.foto} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover bg-white border border-slate-800 hover:opacity-80 transition-opacity" />
                              </button>
                            ) : (
                              <div className="w-9 h-9 shrink-0 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-xs">🧉</div>
                            )}
                            <div className="min-w-0">
                              <a href={`https://articulo.mercadolibre.com.ar/${p.item_id.replace('MLA', 'MLA-')}`} target="_blank" rel="noreferrer"
                                className="block truncate hover:text-emerald-300" title={p.titulo}>{p.titulo}</a>
                              {p.sinCosto && <span className="text-[11px] text-amber-300">sin costo cargado</span>}
                            </div>
                          </div>
                        </td>
                        <td className="text-right pl-3">{p.unidades}</td>
                        <td className="text-right pl-3">{fmt(p.venta)}</td>
                        <td className="text-right pl-3 text-slate-400 hidden sm:table-cell">{fmt(p.costo)}</td>
                        <td className={`text-right pl-3 ${color(p.neto)}`}>{fmt(p.neto)}</td>
                        <td className="text-right pl-3 text-slate-400">{pct(p.neto, p.venta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.productos.length > 25 && (
                <button onClick={() => setVerTodos((v) => !v)} className="mt-3 text-sm text-emerald-400 hover:text-emerald-300">
                  {verTodos ? 'Ver menos' : `Ver las ${d.productos.length} publicaciones`}
                </button>
              )}
            </section>

            <Ventas key={`${d.desde}-${d.hasta}`} ventas={d.ventas} />
          </>
        )}
      </main>
      {zoom && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.titulo}>
          <figure className="bg-slate-900 border border-slate-800 rounded-2xl p-3 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.src} alt={zoom.titulo} className="w-full aspect-square object-contain rounded-xl bg-white" />
            <figcaption className="text-sm text-slate-300 mt-2 px-1">{zoom.titulo}</figcaption>
            <button onClick={() => setZoom(null)} className="mt-2 w-full text-sm text-slate-400 hover:text-slate-100 py-1.5">Cerrar</button>
          </figure>
        </div>
      )}
    </div>
  );
}
