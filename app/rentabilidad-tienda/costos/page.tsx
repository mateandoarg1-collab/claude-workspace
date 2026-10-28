'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppHeader from '../../components/AppHeader';
import CostosAdicionales from '../../components/CostosAdicionales';
import type { CostoAdicional } from '@/lib/costosAdicionales';

type CostoProducto = { producto: string; costo: number; actualizado: string };
type SinCosto = { producto: string; ventas: number; unidades: number; ultima: string; foto: string | null };
type Data = { sinCosto: SinCosto[]; manuales: CostoProducto[]; adicionales: CostoAdicional[] };

const entrada = 'rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600';
const ddmm = (f: string) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '');

// Costo de un producto: se edita en la fila y se guarda con Enter o el botón. Vacío y Guardar en uno cargado = borrarlo.
function FilaProducto({ producto, costo, detalle, foto, onGuardado }: {
  producto: string; costo: number | null; detalle: string; foto?: string | null; onGuardado: (d: Data['manuales']) => void;
}) {
  const [valor, setValor] = useState(costo != null ? String(costo) : '');
  const [estado, setEstado] = useState<'guardando' | 'error' | null>(null);
  const numero = valor.trim() === '' ? null : Number(valor.replace(/\./g, '').replace(',', '.'));
  const cambio = numero !== costo && (numero == null ? costo != null : numero >= 0);

  async function guardar() {
    if (!cambio) return;
    setEstado('guardando');
    const r = await fetch('/api/tienda/costos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ producto, costo: numero }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) return setEstado('error');
    setEstado(null);
    onGuardado(r.manuales);
  }

  return (
    <li className="py-2.5 flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {foto !== undefined && (foto ? <img src={foto} alt="" className="h-10 w-10 rounded-lg object-cover bg-white shrink-0" /> : <div className="h-10 w-10 rounded-lg bg-slate-800 shrink-0" />)}
      <div className="min-w-0 flex-1">
        <div className="text-sm truncate">{producto}</div>
        <div className="text-xs text-slate-500">{detalle}</div>
      </div>
      <span className="text-slate-500 text-sm">$</span>
      <input value={valor} onChange={(e) => { setValor(e.target.value); setEstado(null); }} onKeyDown={(e) => e.key === 'Enter' && guardar()}
        inputMode="decimal" placeholder="Sin costo" aria-label={`Costo de ${producto}`}
        className={`${entrada} w-28 text-right tabular-nums ${costo == null && !valor ? 'border-amber-700/60' : ''}`} />
      <button onClick={guardar} disabled={!cambio || estado === 'guardando'}
        className="rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-30 px-3 py-1.5 text-sm text-white shrink-0">
        {estado === 'guardando' ? '…' : numero == null && costo != null ? 'Borrar' : 'Guardar'}
      </button>
      {estado === 'error' && <span className="text-xs text-rose-400">Error</span>}
    </li>
  );
}

export default function CostosTienda() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');

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

  // Al guardar, el producto pasa de «sin costo» a «cargados a mano» (y al revés si se borra).
  const actualizar = (manuales: CostoProducto[]) =>
    setData((d) => d && {
      ...d,
      manuales,
      sinCosto: d.sinCosto.filter((s) => !manuales.some((m) => m.producto.toUpperCase() === s.producto.toUpperCase())),
    });

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
              <h2 className="text-sm font-semibold text-slate-200">Productos sin costo ({data.sinCosto.length})</h2>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">
                Productos de Empretienda vendidos en los últimos 60 días que no tienen costo (productos nuevos o sin regla): hoy cuentan $0.
                Poné el costo por unidad, sin IVA y sin la caja de despacho (esa se suma sola). Las ventas nuevas ya salen con este costo;
                las de días anteriores se recalculan a la mañana.
              </p>
              {data.sinCosto.length ? (
                <ul className="divide-y divide-slate-800">
                  {data.sinCosto.map((s) => (
                    <FilaProducto key={s.producto} producto={s.producto} costo={null} foto={s.foto} onGuardado={actualizar}
                      detalle={`${s.unidades} ${s.unidades === 1 ? 'unidad' : 'unidades'} en ${s.ventas} ${s.ventas === 1 ? 'venta' : 'ventas'} · última ${ddmm(s.ultima)}`} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-emerald-400">Todos los productos vendidos tienen costo.</p>
              )}
            </section>

            {data.manuales.length > 0 && (
              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-200">Costos cargados a mano ({data.manuales.length})</h2>
                <p className="text-xs text-slate-500 mt-0.5 mb-3">Ganan a las reglas automáticas. Borrá el número y guardá para volver a la regla.</p>
                <ul className="divide-y divide-slate-800">
                  {data.manuales.map((m) => (
                    <FilaProducto key={m.producto + m.costo} producto={m.producto} costo={m.costo} onGuardado={actualizar}
                      detalle={m.actualizado ? `Cargado el ${ddmm(m.actualizado.slice(0, 10))}` : ''} />
                  ))}
                </ul>
              </section>
            )}

            <CostosAdicionales iniciales={data.adicionales} />
          </>
        )}
      </main>
    </div>
  );
}
