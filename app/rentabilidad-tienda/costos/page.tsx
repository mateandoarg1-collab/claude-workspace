'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppHeader from '../../components/AppHeader';
import CostosAdicionales from '../../components/CostosAdicionales';
import type { CostoAdicional } from '@/lib/costosAdicionales';

type CostoProducto = { producto: string; costo: number; actualizado: string };
type Producto = {
  producto: string; foto: string | null; activo: boolean; reglaMin: number | null; reglaMax: number | null;
  manual: number | null; unidades: number; ventas: number; ultima: string; sinCosto: boolean;
};
type Data = { productos: Producto[]; adicionales: CostoAdicional[] };
type Filtro = 'sinCosto' | 'vendidos' | 'todos';

const entrada = 'rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600';
const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const ddmm = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '');
const normalizar = (p: string) => p.toUpperCase().replace(/\s+/g, ' ').trim();

function regla(p: Producto) {
  if (p.reglaMin == null) return 'Sin costo por regla';
  return p.reglaMax != null && p.reglaMax > p.reglaMin
    ? `Por regla ${pesos(p.reglaMin)} a ${pesos(p.reglaMax)} según la variante`
    : `Por regla ${pesos(p.reglaMin)}`;
}

// Un producto: el costo a mano se edita en la fila (Enter o Guardar). Vacío y Guardar en uno cargado = volver a la regla.
function FilaProducto({ p, onGuardado }: { p: Producto; onGuardado: (manuales: CostoProducto[]) => void }) {
  const [valor, setValor] = useState(p.manual != null ? String(p.manual) : '');
  const [estado, setEstado] = useState<'guardando' | 'error' | null>(null);
  const numero = valor.trim() === '' ? null : Number(valor.replace(/\./g, '').replace(',', '.'));
  const cambio = numero !== p.manual && (numero == null ? p.manual != null : numero >= 0);

  async function guardar() {
    if (!cambio) return;
    setEstado('guardando');
    const r = await fetch('/api/tienda/costos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ producto: p.producto, costo: numero }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) return setEstado('error');
    setEstado(null);
    onGuardado(r.manuales);
  }

  const vendidas = p.unidades ? `${p.unidades} ${p.unidades === 1 ? 'unidad' : 'unidades'} en 60 días · última ${ddmm(p.ultima)}` : 'Sin ventas en 60 días';
  return (
    <li className="py-2.5 flex items-center gap-3">
      {p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.foto} alt="" className="h-10 w-10 rounded-lg object-cover bg-white shrink-0" />
      ) : (
        <div className="h-10 w-10 rounded-lg bg-slate-800 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">
          {p.producto}
          {!p.activo && <span className="ml-2 text-[11px] text-slate-500">desactivado</span>}
        </div>
        <div className={`text-xs truncate ${p.sinCosto ? 'text-amber-300' : 'text-slate-500'}`}>
          {p.manual != null ? `A mano ${pesos(p.manual)} + regalo o bombilla si la variante los lleva (${regla(p).toLowerCase()})` : regla(p)} · {vendidas}
        </div>
      </div>
      <span className="text-slate-500 text-sm">$</span>
      <input value={valor} onChange={(e) => { setValor(e.target.value); setEstado(null); }} onKeyDown={(e) => e.key === 'Enter' && guardar()}
        inputMode="decimal" aria-label={`Costo de ${p.producto}`}
        placeholder={p.reglaMin != null ? Math.round(p.reglaMin).toLocaleString('es-AR') : 'Sin costo'}
        className={`${entrada} w-28 text-right tabular-nums ${p.sinCosto && !valor ? 'border-amber-700/60' : ''}`} />
      <button onClick={guardar} disabled={!cambio || estado === 'guardando'}
        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 px-3 py-1.5 text-sm text-white shrink-0 w-[4.5rem]">
        {estado === 'guardando' ? '…' : numero == null && p.manual != null ? 'Borrar' : 'Guardar'}
      </button>
      {estado === 'error' && <span className="text-xs text-rose-400">Error</span>}
    </li>
  );
}

export default function CostosTienda() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState<Filtro | null>(null);
  const [q, setQ] = useState('');
  const [limite, setLimite] = useState(80);

  useEffect(() => {
    let vivo = true;
    fetch('/api/tienda/costos', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && (d.error ? setErr(d.error) : setData(d)))
      .catch((e) => vivo && setErr(String(e)));
    return () => {
      vivo = false;
    };
  }, []);

  // Al guardar se actualiza el costo a mano de cada producto según la lista que devuelve la API.
  const actualizar = (manuales: CostoProducto[]) =>
    setData((d) => {
      if (!d) return d;
      const m = new Map(manuales.map((x) => [normalizar(x.producto), x.costo]));
      return { ...d, productos: d.productos.map((p) => {
        const manual = m.get(normalizar(p.producto)) ?? null;
        return { ...p, manual, sinCosto: manual == null && (p.sinCosto || (p.unidades > 0 && p.reglaMin == null)) };
      }) };
    });

  const productos = useMemo(() => data?.productos ?? [], [data]);
  const cuentas = {
    sinCosto: productos.filter((p) => p.sinCosto).length,
    vendidos: productos.filter((p) => p.unidades > 0).length,
    todos: productos.length,
  };
  // Por defecto: los sin costo si hay, si no los vendidos.
  const activo: Filtro = filtro ?? (cuentas.sinCosto ? 'sinCosto' : 'vendidos');
  const lista = useMemo(() => {
    const t = normalizar(q);
    return productos.filter((p) =>
      (!t || normalizar(p.producto).includes(t)) &&
      (activo === 'todos' || (activo === 'sinCosto' ? p.sinCosto : p.unidades > 0)));
  }, [productos, q, activo]);

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Costos" subtitle="Costo de producto de la tienda y costos adicionales de cada canal" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Link href="/rentabilidad-tienda" className="text-sm text-slate-400 hover:text-emerald-300">← Volver a la rentabilidad</Link>
        {err && <p className="text-sm text-rose-400">{err}</p>}
        {!data && !err && <p className="text-sm text-slate-500">Cargando…</p>}
        {data && (
          <>
            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-slate-200">Costo de producto de la tienda</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Costo por unidad sin IVA del producto solo. «Por regla» es el que sale de la planilla de costos por SKU; si ponés uno a
                mano, reemplaza al de la regla (borralo para volver) y vale para todas las variantes: la caja o bolsa de regalo, la
                bombilla y el packaging se le siguen sumando solos según cada venta. Las ventas nuevas ya salen con el costo nuevo; las de
                días anteriores se recalculan a la mañana.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto…" className={`${entrada} flex-1`} />
                <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-950 self-start">
                  {([['sinCosto', 'Sin costo'], ['vendidos', 'Vendidos'], ['todos', 'Todos']] as const).map(([id, nombre]) => (
                    <button key={id} onClick={() => { setFiltro(id); setLimite(80); }}
                      className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap transition-colors ${activo === id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                      {nombre} ({cuentas[id]})
                    </button>
                  ))}
                </div>
              </div>
              {lista.length ? (
                <>
                  <ul className="divide-y divide-slate-800">
                    {lista.slice(0, limite).map((p) => (
                      <FilaProducto key={p.producto + (p.manual ?? '')} p={p} onGuardado={actualizar} />
                    ))}
                  </ul>
                  {lista.length > limite && (
                    <button onClick={() => setLimite((l) => l + 200)} className="mt-3 text-sm text-slate-400 hover:text-emerald-300">
                      Ver más ({lista.length - limite})
                    </button>
                  )}
                </>
              ) : (
                <p className="text-sm text-emerald-400">{activo === 'sinCosto' && !q ? '✅ Todos los productos vendidos tienen costo.' : 'Ningún producto coincide.'}</p>
              )}
            </section>

            <CostosAdicionales iniciales={data.adicionales} />
          </>
        )}
      </main>
    </div>
  );
}
