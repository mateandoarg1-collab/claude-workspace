'use client';

import { useEffect, useRef, useState } from 'react';
import CanalMarca, { type CanalId } from './CanalMarca';

type Dia = { dia: string; ventas: number | null; monto: number | null };
const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const corto = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : fmt(n);

// Barras por día del mes en curso del canal tocado en la tabla de /canales: ventas o facturación.
export default function CanalDailyChart({ canal, onClose }: { canal: CanalId; onClose: () => void }) {
  const [res, setRes] = useState<{ canal: string; dias?: Dia[]; err?: string } | null>(null);
  const [modo, setModo] = useState<'monto' | 'ventas'>('monto');
  const [activo, setActivo] = useState<number | null>(null);
  const ref = useRef<HTMLElement>(null);

  // al abrir o cambiar de canal, bajar hasta el gráfico (queda debajo de la tabla, fuera de pantalla)
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [canal]);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/canales/diario?canal=${canal}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { canal, err: d.error } : { canal, dias: d.dias }))
      .catch((e) => vivo && setRes({ canal, err: String(e) }));
    return () => { vivo = false; };
  }, [canal]);

  const dias = res?.canal === canal ? res.dias ?? null : null;
  const err = res?.canal === canal ? res.err : '';
  const val = (d: Dia) => (modo === 'monto' ? d.monto : d.ventas) ?? 0;
  const max = Math.max(1, ...(dias ?? []).map(val));
  const total = (dias ?? []).reduce((s, d) => s + val(d), 0);
  const faltan = (dias ?? []).filter((d) => d.ventas === null).length;
  const sel = activo != null && dias ? dias[activo] : null;
  const H = 160;

  return (
    <section ref={ref} className="scroll-mt-4 bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <CanalMarca id={canal} />
          <span className="text-sm text-slate-400">por día · mes en curso</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-950 text-sm">
            {(['monto', 'ventas'] as const).map((m) => (
              <button key={m} onClick={() => setModo(m)}
                className={`px-3 py-1 rounded-md ${modo === m ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
                {m === 'monto' ? 'Facturación' : 'Ventas'}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-100 px-2" aria-label="Cerrar">✕</button>
        </div>
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}
      {!dias && !err && <div className="text-sm text-slate-400" style={{ height: H }}>Cargando…</div>}
      {dias && (
        <>
          <div className="text-sm text-slate-300 mb-2 h-5">
            {sel
              ? <>{Number(sel.dia.slice(8))}/{Number(sel.dia.slice(5, 7))}: <b>{sel.ventas === null ? 'sin dato' : modo === 'monto' ? fmt(sel.monto ?? 0) : `${sel.ventas} ventas`}</b></>
              : <>Total: <b>{modo === 'monto' ? fmt(total) : `${total} ventas`}</b> · máx. día {modo === 'monto' ? corto(max) : max}</>}
          </div>
          <div className="flex items-end gap-[3px]" style={{ height: H }} onMouseLeave={() => setActivo(null)}>
            {dias.map((d, i) => (
              <button key={d.dia} onMouseEnter={() => setActivo(i)} onClick={() => setActivo(i)}
                className="flex-1 h-full flex items-end" title={d.dia}>
                <div
                  className={`w-full rounded-t ${d.ventas === null ? 'bg-slate-800 border border-dashed border-slate-700' : activo === i ? 'bg-emerald-300' : 'bg-emerald-600'}`}
                  style={{ height: d.ventas === null ? 6 : Math.max(2, (val(d) / max) * H) }}
                />
              </button>
            ))}
          </div>
          <div className="flex gap-[3px] mt-1 text-[10px] text-slate-500">
            {dias.map((d) => (
              <div key={d.dia} className="flex-1 text-center">{Number(d.dia.slice(8)) % 5 === 1 ? Number(d.dia.slice(8)) : ''}</div>
            ))}
          </div>
          {faltan > 0 && (
            <p className="text-xs text-slate-500 mt-3">
              {faltan} días todavía sin dato: el histórico de Empretienda se va completando solo (4 días cada media hora).
            </p>
          )}
        </>
      )}
    </section>
  );
}
