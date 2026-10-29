'use client';

import { useEffect, useState } from 'react';

type Estado = { revision: string; ultimoTildado: string; estado: string; resumen: string; pendientes: number | null };

const hace = (iso: string, ahora: number) => {
  if (!iso) return 'nunca';
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `hace ${h} h${min % 60 && h < 6 ? ` ${min % 60} min` : ''}` : `hace ${Math.floor(h / 24)} días`;
};

// Aviso para Machado y el equipo: si el tildador de comprobantes (servidor de DonWeb, cada 5 min) está andando.
// Rojo si la última revisión tiene más de 30 min o terminó con error.
export default function AvisoTildador() {
  const [e, setE] = useState<Estado | null>(null);
  const [ahora] = useState(() => Date.now());
  useEffect(() => {
    let vivo = true;
    fetch('/api/tildador', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && !d.error && setE(d))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  if (!e) return null;
  const minRev = e.revision ? (ahora - Date.parse(e.revision)) / 60000 : Infinity;
  const mal = e.estado === 'error' || minRev > 30;
  return (
    <div className={`flex items-center gap-x-4 gap-y-1 flex-wrap rounded-xl border px-4 py-2.5 text-sm ${mal ? 'border-rose-800/60 bg-rose-950/30' : 'border-slate-800 bg-slate-900'}`}>
      <span className={`font-semibold ${mal ? 'text-rose-300' : 'text-emerald-300'}`}>🧾 Comprobantes</span>
      <span>
        Último tildado <b>{hace(e.ultimoTildado, ahora)}</b>
      </span>
      <span className={mal ? 'text-rose-300' : 'text-slate-400'}>
        {mal ? (e.estado === 'error' ? `La última revisión falló (${hace(e.revision, ahora)})` : `Sin revisar ${hace(e.revision, ahora)}`) : `Revisado ${hace(e.revision, ahora)}`}
      </span>
      {e.pendientes ? <span className="text-xs text-slate-500">{e.pendientes} {e.pendientes === 1 ? 'orden esperando' : 'órdenes esperando'} el pago</span> : null}
    </div>
  );
}
