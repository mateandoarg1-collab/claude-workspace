'use client';

import { useState } from 'react';

// Tarjetas de indicadores con minigráfico, compartidas por /rentabilidad-meli y /rentabilidad-tienda.
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const nomDia = (f: string) => `${DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`;
export const num = (n: number, dec = 2) => n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
export const porc = (n: number) => `${num(n * 100, 1)}%`;


// Línea diaria de una métrica, con el valor del día bajo el cursor. Los días sin dato (p. ej. ROAS sin pauta) cortan la línea.
export function Minigrafico({ puntos, formato }: { puntos: { fecha: string; v: number | null }[]; formato: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = puntos.map((p) => p.v).filter((v): v is number => v != null);
  if (puntos.length < 2 || vals.length < 2) return <div className="h-10" />;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i: number) => (i / (puntos.length - 1)) * 100;
  const y = (v: number) => (max === min ? 20 : 36 - ((v - min) / (max - min)) * 32);
  let d = '';
  puntos.forEach((p, i) => {
    if (p.v == null) return;
    d += `${i && puntos[i - 1].v != null ? 'L' : 'M'}${x(i)},${y(p.v)}`;
  });
  const h = hover != null ? puntos[hover] : null;
  return (
    <div className="relative h-10 mt-2"
      onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setHover(Math.round(((e.clientX - r.left) / r.width) * (puntos.length - 1)));
      }}>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" className="text-emerald-400" />
        {h && <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={40} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-slate-600" />}
      </svg>
      {h && h.v != null && (
        <span className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full bg-emerald-400 ring-2 ring-slate-900 pointer-events-none"
          style={{ left: `${x(hover!)}%`, top: `${(y(h.v) / 40) * 100}%` }} />
      )}
      {h && (
        <span className={`absolute top-0 ${x(hover!) < 50 ? 'right-0' : 'left-0'} text-[11px] tabular-nums text-slate-200 bg-slate-800/95 rounded px-1.5 py-0.5 pointer-events-none whitespace-nowrap`}>
          {nomDia(h.fecha)} · {h.v == null ? '–' : formato(h.v)}
        </span>
      )}
    </div>
  );
}

// Tarjeta tipo Escalafy: valor del período, variación contra el período anterior del mismo largo y la línea diaria.
// `mejorSiSube` pinta la variación de verde o rojo; los porcentajes (margen, ACOS, TACOS) varían en puntos.
export function Tarjeta({ titulo, valor, actual, anterior, enPuntos, mejorSiSube = true, detalle, puntos, formato }: {
  titulo: string; valor: string; actual: number | null; anterior?: number | null; enPuntos?: boolean; mejorSiSube?: boolean;
  detalle?: string; puntos: { fecha: string; v: number | null }[]; formato: (n: number) => string;
}) {
  let variacion: { texto: string; sube: boolean } | null = null;
  if (actual != null && anterior != null && (enPuntos || anterior !== 0)) {
    const dif = enPuntos ? (actual - anterior) * 100 : ((actual - anterior) / Math.abs(anterior)) * 100;
    variacion = { texto: enPuntos ? `${num(Math.abs(dif), 1)} pp` : `${num(Math.abs(dif), 1)}%`, sube: dif >= 0 };
  }
  return (
    <div className="bg-slate-900 rounded-2xl border border-slate-800 p-4 min-w-0">
      <p className="text-xs text-slate-400 truncate">{titulo}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-xl sm:text-2xl font-semibold tabular-nums text-slate-50">{valor}</p>
        {variacion && (
          <span className={`text-xs tabular-nums ${variacion.sube === mejorSiSube ? 'text-emerald-400' : 'text-rose-400'}`}
            title="Contra el período anterior del mismo largo">
            {variacion.sube ? '↑' : '↓'} {variacion.texto}
          </span>
        )}
      </div>
      {detalle && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{detalle}</p>}
      <Minigrafico puntos={puntos} formato={formato} />
    </div>
  );
}

