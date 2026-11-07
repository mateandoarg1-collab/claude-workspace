'use client';

import { useEffect, useState } from 'react';
import type { Saldo } from '../api/saldos/route';

const corto = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1).replace('.', ',')} M` : `$${Math.round(n / 1000).toLocaleString('es-AR')} mil`);

// Fila de arriba de todo del panel: saldo de cada cuenta publicitaria. Rojo si se quedó sin saldo o la cuenta tiene un
// problema (se corta la pauta), ámbar si queda poco (Meta: 1 día de gasto; Google: $200.000). Las cuentas con tarjeta y sin problemas no ocupan lugar.
export default function AvisoSaldos() {
  const [cuentas, setCuentas] = useState<Saldo[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const leer = () =>
      fetch('/api/saldos', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => vivo && setCuentas(d.cuentas ?? []))
        .catch(() => {});
    leer();
    const id = setInterval(() => !document.hidden && leer(), 10 * 60 * 1000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, []);
  const ver = (cuentas ?? []).filter((c) => c.tipo === 'prepaga' || c.estado !== 'ok');
  if (!ver.length) return null;
  const grave = ver.some((c) => c.estado !== 'ok');
  return (
    <div className={`border-t text-xs ${grave ? 'border-rose-800/60 bg-rose-950/60' : 'border-slate-800 bg-slate-950/60'}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
        <span className={`font-semibold ${grave ? 'text-rose-300' : 'text-slate-400'}`}>{grave ? '🚨 Saldo de pauta' : 'Saldo de pauta'}</span>
        {ver.map((c) => {
          const color = c.estado === 'ok' ? 'text-slate-300' : c.estado === 'poco' ? 'text-amber-300 font-semibold' : 'text-rose-300 font-semibold';
          const texto =
            c.estado === 'problema' ? c.detalle
            : c.estado === 'agotado' ? `sin saldo${c.saldo != null && c.saldo < -1000 ? ` (${corto(c.saldo)})` : ''} · se corta la pauta`
            : `${corto(c.saldo ?? 0)}${c.dias != null ? ` · ${c.dias < 1 ? 'menos de 1 día' : `~${Math.floor(c.dias)} días`}` : ''}${c.estado === 'poco' ? ' · cargar saldo' : ''}`;
          return (
            <span key={c.cuenta} className={color}>
              {c.cuenta}: {texto}
            </span>
          );
        })}
      </div>
    </div>
  );
}
