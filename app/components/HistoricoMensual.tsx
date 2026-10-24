'use client';

import { useEffect, useState } from 'react';
import CanalMarca, { type CanalId } from './CanalMarca';

type Fila = { mes: string; canal: string; monto: number; ventas: number };

const CANALES: CanalId[] = ['online', 'ml', 'local', 'shopify', 'mayorista'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const nomMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const millones = (n: number) => (n ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} M` : '—');
const num = (n: number) => (n ? Math.round(n).toLocaleString('es-AR') : '—');

// Ventas por mes y canal desde mayo (pestaña historico_mensual). El mes en curso se va actualizando: Tienda Online y
// Local cada 30 min (lector de Empretienda), Meli, Shopify y Mayorista una vez por día.
export default function HistoricoMensual() {
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [err, setErr] = useState('');
  const [ver, setVer] = useState<'monto' | 'ventas'>('monto');
  const [mesActual] = useState(() => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7));

  useEffect(() => {
    fetch('/api/canales/historico', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setFilas(d.filas)))
      .catch((e) => setErr(String(e)));
  }, []);

  const meses = [...new Set((filas ?? []).map((f) => f.mes))].sort().reverse();
  const val = (mes: string, canal: string) => {
    const f = filas?.find((x) => x.mes === mes && x.canal === canal);
    return f ? (ver === 'monto' ? f.monto : f.ventas) : 0;
  };
  const total = (mes: string) => CANALES.reduce((s, c) => s + val(mes, c), 0);
  const maxTotal = Math.max(1, ...meses.map(total));
  const fmtV = ver === 'monto' ? millones : num;

  return (
    <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="text-lg font-semibold">Histórico por mes</h2>
        <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-950">
          {(['monto', 'ventas'] as const).map((v) => (
            <button key={v} onClick={() => setVer(v)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${ver === v ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
              {v === 'monto' ? 'Facturación' : 'Ventas'}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}
      {!filas && !err && <p className="text-sm text-slate-400">Cargando…</p>}
      {filas && (
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2 text-left">Mes</th>
                {CANALES.map((c) => (
                  <th key={c} className="text-right pl-3 font-normal"><span className="inline-flex justify-end"><CanalMarca id={c} /></span></th>
                ))}
                <th className="text-right pl-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => (
                <tr key={m} className="border-t border-slate-800">
                  <td className="py-2.5 font-medium whitespace-nowrap">
                    {nomMes(m)}
                    {m === mesActual && <span className="ml-1 text-[11px] font-normal text-slate-500">(en curso)</span>}
                  </td>
                  {CANALES.map((c) => (
                    <td key={c} className="text-right tabular-nums pl-3 text-slate-300">{fmtV(val(m, c))}</td>
                  ))}
                  <td className="text-right tabular-nums pl-3 font-bold">
                    <div>{fmtV(total(m))}</div>
                    <div className="h-1 rounded bg-slate-800 mt-1 ml-auto w-24">
                      <div className="h-1 rounded bg-emerald-600 ml-auto" style={{ width: `${(total(m) / maxTotal) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500 mt-3">
        Facturación con IVA, mismos criterios que la tabla de arriba. Tienda Online y Local: hasta septiembre, de las órdenes pagadas del panel de
        Empretienda (carga única); desde octubre, de Métricas. Meli, Shopify y Mayorista se guardan una vez por día; el mes se cierra el día 1.
      </p>
    </section>
  );
}
