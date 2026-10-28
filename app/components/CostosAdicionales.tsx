'use client';

import { useState } from 'react';
import { BASES, CANALES, describirAdicional, type Canal, type CostoAdicional } from '@/lib/costosAdicionales';

// Editor de los costos adicionales de todos los canales (pestaña costos_adicionales): lo usan /rentabilidad-meli/costos y
// /rentabilidad-tienda/costos. Guarda la lista entera por /api/ml/costos.
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const entrada = 'rounded-lg bg-slate-950 border border-slate-800 px-2.5 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-emerald-600';

const VACIO: CostoAdicional = { nombre: '', tipo: 'fijo', monto: 0, base: '', desde: hoyAR(), hasta: '', canal: 'tienda' };

export default function CostosAdicionales({ iniciales }: { iniciales: CostoAdicional[] }) {
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
