'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppHeader from '../../components/AppHeader';
import { BASES, CANALES, describirAdicional, type Canal, type CostoAdicional } from '@/lib/costosAdicionales';

type Publicacion = {
  item_id: string; variant_id: string | null; titulo: string; variante: string | null; foto: string | null;
  costo: number | null; activa: boolean; vendidas30: number; sinCosto30: number;
};

const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const clave = (p: Publicacion) => `${p.item_id}|${p.variant_id ?? ''}`;
const entrada = 'rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600';

// Una fila de la tabla de publicaciones: el costo se edita ahí mismo. Si la publicación ya tenía costo, se pide
// desde qué fecha rige el nuevo (las ventas anteriores quedan con el costo viejo).
function FilaCosto({ p, onGuardado }: { p: Publicacion; onGuardado: (costo: number) => void }) {
  const [valor, setValor] = useState(p.costo == null ? '' : String(p.costo));
  const [desde, setDesde] = useState(p.costo ? hoyAR() : 'siempre');
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'guardando'; texto?: string } | null>(null);
  const numero = Number(valor.replace(/\./g, '').replace(',', '.'));
  const cambio = valor.trim() !== '' && numero >= 0 && numero !== (p.costo ?? -1);

  async function guardar() {
    setEstado({ tipo: 'guardando' });
    const r = await fetch('/api/ml/costos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: p.item_id, variant_id: p.variant_id, costo: numero, desde, nombre: [p.titulo, p.variante].filter(Boolean).join(' · ') }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) return setEstado({ tipo: 'error', texto: r.error });
    setEstado({ tipo: 'ok', texto: r.ventasRecalculadas ? `Guardado · ${r.ventasRecalculadas} ventas recalculadas` : 'Guardado' });
    onGuardado(numero);
  }

  return (
    <tr className="border-t border-slate-800/60 align-top">
      <td className="py-2.5 pr-3 max-w-[10rem] sm:max-w-md">
        <div className="flex items-center gap-3 min-w-0">
          {p.foto ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.foto} alt="" loading="lazy" className="w-9 h-9 rounded-lg object-cover bg-white border border-slate-800 shrink-0" />
          ) : (
            <div className="w-9 h-9 shrink-0 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-center text-xs">🧉</div>
          )}
          <div className="min-w-0">
            <a href={`https://articulo.mercadolibre.com.ar/${p.item_id.replace('MLA', 'MLA-')}`} target="_blank" rel="noreferrer"
              className="block truncate text-sm hover:text-emerald-300" title={p.titulo}>{p.titulo}</a>
            <p className="text-[11px] text-slate-500 truncate">
              {[p.variante, p.item_id, !p.activa && 'pausada o finalizada'].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </td>
      <td className="py-2.5 pl-2 text-right text-sm tabular-nums text-slate-400 hidden sm:table-cell">
        {p.vendidas30 || '–'}
        {p.sinCosto30 > 0 && <span className="block text-[11px] text-amber-300">{p.sinCosto30} sin costo</span>}
      </td>
      <td className="py-2.5 pl-3">
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 text-sm">$</span>
            <input value={valor} onChange={(e) => { setValor(e.target.value); setEstado(null); }} inputMode="decimal" placeholder="Sin costo"
              aria-label={`Costo de ${p.titulo}`} className={`${entrada} w-28 text-right tabular-nums ${p.costo == null && !valor ? 'border-amber-700/60' : ''}`} />
          </div>
          {cambio && (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {p.costo ? (
                <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                  Desde
                  <input type="date" value={desde === 'siempre' ? hoyAR() : desde} onChange={(e) => setDesde(e.target.value || hoyAR())} className={`${entrada} py-1 text-xs`} />
                </label>
              ) : (
                <span className="text-[11px] text-slate-400">Para todas sus ventas</span>
              )}
              <button onClick={guardar} disabled={estado?.tipo === 'guardando'}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1 text-sm text-white">
                {estado?.tipo === 'guardando' ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
          {estado && estado.tipo !== 'guardando' && (
            <span className={`text-[11px] ${estado.tipo === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{estado.texto}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

const VACIO: CostoAdicional = { nombre: '', tipo: 'fijo', monto: 0, base: '', desde: hoyAR(), hasta: '', canal: 'tienda' };

function CostosAdicionales({ iniciales }: { iniciales: CostoAdicional[] }) {
  const [lista, setLista] = useState(iniciales);
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error' | 'guardando'; texto?: string } | null>(null);
  const cambio = JSON.stringify(lista) !== JSON.stringify(iniciales);
  const editar = (i: number, c: Partial<CostoAdicional>) => {
    setLista((l) => l.map((x, j) => (j === i ? { ...x, ...c } : x)));
    setEstado(null);
  };

  async function guardar() {
    setEstado({ tipo: 'guardando' });
    const r = await fetch('/api/ml/costos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adicionales: lista }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) return setEstado({ tipo: 'error', texto: r.error });
    setLista(r.adicionales);
    setEstado({ tipo: 'ok', texto: 'Guardado. La rentabilidad ya los usa.' });
  }

  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-slate-200">Costos adicionales</h2>
      <p className="text-xs text-slate-500 mt-0.5 mb-4">
        Costos fuera de la venta (sueldos, alquiler, apps, agencia…) de cada canal: restan en su ganancia (en Mercado Libre, en la final).
        Un fijo se reparte por día; para dar de baja uno, poné la fecha hasta.
      </p>
      <div className="space-y-3">
        {lista.map((c, i) => (
          <div key={i} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 grid grid-cols-2 sm:grid-cols-7 gap-2 items-end">
            <label className="col-span-2 sm:col-span-1 text-[11px] text-slate-400">Canal
              <select value={c.canal} onChange={(e) => editar(i, { canal: e.target.value as Canal })} className={`${entrada} w-full mt-1`}>
                {Object.entries(CANALES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="col-span-2 text-[11px] text-slate-400">Nombre
              <input value={c.nombre} onChange={(e) => editar(i, { nombre: e.target.value })} className={`${entrada} w-full mt-1`} />
            </label>
            <label className="text-[11px] text-slate-400">Tipo
              <select value={c.tipo} onChange={(e) => editar(i, e.target.value === 'variable' ? { tipo: 'variable', base: c.base || 'venta' } : { tipo: 'fijo', base: '' })}
                className={`${entrada} w-full mt-1`}>
                <option value="fijo">Fijo por mes</option>
                <option value="variable">Variable</option>
              </select>
            </label>
            <label className="text-[11px] text-slate-400">{c.tipo === 'fijo' || c.base === 'pedido' ? 'Monto ($)' : 'Porcentaje (%)'}
              <input value={c.monto || ''} onChange={(e) => editar(i, { monto: Number(e.target.value.replace(',', '.')) || 0 })} inputMode="decimal"
                className={`${entrada} w-full mt-1 text-right tabular-nums`} />
            </label>
            <label className="text-[11px] text-slate-400">Desde
              <input type="date" value={c.desde} onChange={(e) => editar(i, { desde: e.target.value })} className={`${entrada} w-full mt-1`} />
            </label>
            <label className="text-[11px] text-slate-400">Hasta
              <input type="date" value={c.hasta} onChange={(e) => editar(i, { hasta: e.target.value })} className={`${entrada} w-full mt-1`} />
            </label>
            {c.tipo === 'variable' && (
              <label className="col-span-2 sm:col-span-4 text-[11px] text-slate-400">Se calcula sobre
                <select value={c.base} onChange={(e) => editar(i, { base: e.target.value as CostoAdicional['base'] })} className={`${entrada} w-full mt-1`}>
                  {Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
            <div className={`${c.tipo === 'variable' ? 'col-span-2 sm:col-span-3' : 'col-span-2 sm:col-span-7'} flex items-center justify-between gap-2`}>
              <span className="text-[11px] text-slate-500">{c.nombre && describirAdicional(c)}</span>
              <button onClick={() => setLista((l) => l.filter((_, j) => j !== i))} className="text-[11px] text-slate-500 hover:text-rose-400">Borrar</button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-4 flex-wrap">
        <button onClick={() => setLista((l) => [...l, { ...VACIO }])} className="rounded-lg border border-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:border-emerald-600">
          + Agregar costo
        </button>
        {cambio && (
          <button onClick={guardar} disabled={estado?.tipo === 'guardando'} className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-sm text-white">
            {estado?.tipo === 'guardando' ? 'Guardando…' : 'Guardar cambios'}
          </button>
        )}
        {estado && estado.tipo !== 'guardando' && (
          <span className={`text-xs ${estado.tipo === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>{estado.texto}</span>
        )}
      </div>
    </section>
  );
}

export default function CostosMeli() {
  const [data, setData] = useState<{ publicaciones: Publicacion[]; adicionales: CostoAdicional[] } | null>(null);
  const [err, setErr] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<'sin' | 'activas' | 'todas'>('sin');

  useEffect(() => {
    fetch('/api/ml/costos', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => setErr(String(e)));
  }, []);

  const sinCosto = (p: Publicacion) => p.costo == null && (p.activa || p.vendidas30 > 0);
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return (data?.publicaciones ?? [])
      .filter((p) => (q ? `${p.titulo} ${p.variante ?? ''} ${p.item_id}`.toLowerCase().includes(q) : filtro === 'sin' ? sinCosto(p) : filtro === 'activas' ? p.activa : true))
      .sort((a, b) => b.sinCosto30 - a.sinCosto30 || b.vendidas30 - a.vendidas30 || a.titulo.localeCompare(b.titulo));
  }, [data, busqueda, filtro]);
  const faltan = (data?.publicaciones ?? []).filter(sinCosto).length;

  const guardado = (p: Publicacion, costo: number) =>
    setData((d) => d && { ...d, publicaciones: d.publicaciones.map((x) => (clave(x) === clave(p) ? { ...x, costo, sinCosto30: 0 } : x)) });

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Costos" subtitle="Costo de producto de Mercado Libre y costos adicionales de cada canal" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Link href="/rentabilidad-meli" className="text-sm text-slate-400 hover:text-emerald-300">← Volver a la rentabilidad</Link>
        {err && <p className="text-sm text-rose-400">No se pudieron leer los costos: {err}</p>}
        {!data && !err && <p className="text-sm text-slate-500">Cargando publicaciones…</p>}

        {data && (
          <>
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200">Costo de producto por publicación</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-4">
                Costo por unidad sin IVA, con bombilla y packaging. Una publicación nueva toma el costo para todas sus ventas; si cambiás
                un costo, elegí desde qué fecha rige. Las ventas se recalculan al guardar.
              </p>
              <div className="flex items-center gap-3 flex-wrap mb-3">
                <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por nombre o MLA…"
                  className={`${entrada} flex-1 min-w-[12rem]`} />
                {!busqueda && (
                  <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-950">
                    {([['sin', `Sin costo (${faltan})`], ['activas', 'Activas'], ['todas', 'Todas']] as const).map(([id, label]) => (
                      <button key={id} onClick={() => setFiltro(id)}
                        className={`px-3 py-1 text-sm rounded-md whitespace-nowrap ${filtro === id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {visibles.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="text-left text-xs uppercase text-slate-400">
                      <tr>
                        <th className="py-2">Publicación</th>
                        <th className="text-right pl-2 hidden sm:table-cell font-medium">Vendidas 30 d</th>
                        <th className="text-right pl-3 font-medium">Costo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.slice(0, 150).map((p) => <FilaCosto key={clave(p)} p={p} onGuardado={(c) => guardado(p, c)} />)}
                    </tbody>
                  </table>
                  {visibles.length > 150 && <p className="text-xs text-slate-500 mt-2">Mostrando 150 de {visibles.length}: buscá para encontrar el resto.</p>}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-4">{filtro === 'sin' && !busqueda ? '✅ Todas las publicaciones activas tienen costo.' : 'No hay publicaciones con esa búsqueda.'}</p>
              )}
            </section>

            <CostosAdicionales iniciales={data.adicionales} />
          </>
        )}
      </main>
    </div>
  );
}
