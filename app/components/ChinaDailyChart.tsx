'use client';

import { useEffect, useRef, useState } from 'react';

type Day = { day: number; qty: number; revenue: number };
type Product = {
  id: string;
  title: string;
  color: string | null;
  thumbnail: string | null;
  qty: number;
  revenue: number;
  daily: Record<number, { qty: number; revenue: number }>;
};
type Data = { year: number; month: number; today: number; days: Day[]; products: Product[] };

// El título de ML termina con el color; lo sacamos porque va en el chip.
function stripColor(title: string, color: string | null) {
  if (!color) return title;
  const suffix = ' ' + color;
  return title.toLowerCase().endsWith(suffix.toLowerCase()) ? title.slice(0, -suffix.length) : title;
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

// Tope "lindo" para el eje: 1, 2, 5, 10, 20, 50…
function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= v) ?? 10 * pow;
}

// Unidades chinas vendidas por día del mes en curso. Siempre muestra el mes completo,
// independiente del período elegido en la tabla.
export default function ChinaDailyChart() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [active, setActive] = useState<number | null>(null);
  // Día elegido (tocando una barra o una fila) para ver qué productos salieron ese día.
  const [picked, setPicked] = useState<number | null>(null);
  const tableRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    fetch('/api/ml/china-diario', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, []);

  const H = 140; // alto del área de barras en px
  const past = data ? data.days.filter((d) => d.day <= data.today) : [];
  const total = past.reduce((s, d) => s + d.qty, 0);
  const max = niceMax(Math.max(0, ...past.map((d) => d.qty)));
  const best = past.reduce<Day | null>((b, d) => (d.qty > (b?.qty ?? 0) ? d : b), null);
  const shown = active != null && data ? data.days[active - 1] : null;
  const mon = data ? MONTHS[data.month - 1].slice(0, 3) : '';
  const prods = (data?.products ?? [])
    .map((p) => (picked == null ? p : { ...p, ...(p.daily[picked] ?? { qty: 0, revenue: 0 }) }))
    .filter((p) => p.qty > 0)
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue);
  const pick = (day: number) => setPicked((cur) => (cur === day ? null : day));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-medium text-slate-700">🇨🇳 Unidades chinas por día</h2>
          <p className="text-xs text-slate-400">
            {data ? `${MONTHS[data.month - 1]} ${data.year} · ${total} unidades · promedio ${(total / Math.max(1, data.today)).toFixed(1)}/día` : err || 'Cargando…'}
          </p>
        </div>
        {/* Detalle del día con hover / tap */}
        <div className="text-right text-xs text-slate-500 min-h-[2rem] tabular-nums whitespace-nowrap">
          {shown && (
            <>
              <div className="font-semibold text-slate-800">{shown.day} {MONTHS[(data?.month ?? 1) - 1].slice(0, 3)}: {shown.qty} u.</div>
              <div>{fmt(shown.revenue)}</div>
            </>
          )}
        </div>
      </div>

      {data && (
        <div className="flex gap-2">
          {/* Eje Y: solo 0, mitad y tope */}
          <div className="relative text-[10px] text-slate-400 tabular-nums w-5 flex-shrink-0" style={{ height: H }}>
            {[max, max / 2, 0].map((t, i) => (
              <span key={i} className="absolute right-0 -translate-y-1/2" style={{ top: (i * H) / 2 }}>
                {Number.isInteger(t) ? t : ''}
              </span>
            ))}
          </div>

          <div className="flex-1 min-w-0">
            <div className="relative" style={{ height: H }}>
              {[0, 0.5, 1].map((f) => (
                <div key={f} className="absolute inset-x-0 border-t border-slate-100" style={{ top: f * H }} />
              ))}
              <div className="absolute inset-0 flex items-end gap-[2px]" onMouseLeave={() => setActive(null)}>
                {data.days.map((d) => {
                  const future = d.day > data.today;
                  const h = future ? 0 : Math.round((d.qty / max) * H);
                  const isActive = active === d.day;
                  return (
                    <button
                      key={d.day}
                      type="button"
                      disabled={future}
                      onMouseEnter={() => setActive(d.day)}
                      onFocus={() => setActive(d.day)}
                      onClick={() => { setActive(d.day); pick(d.day); if (tableRef.current) tableRef.current.open = true; }}
                      aria-label={`${d.day}: ${d.qty} unidades, ${fmt(d.revenue)}`}
                      aria-pressed={picked === d.day}
                      className="relative flex-1 h-full flex items-end justify-center cursor-pointer disabled:cursor-default"
                    >
                      {best && d.day === best.day && !shown && (
                        <span className="absolute text-[10px] font-semibold text-slate-700 tabular-nums" style={{ bottom: h + 2 }}>
                          {d.qty}
                        </span>
                      )}
                      <span
                        className={`block w-full max-w-[24px] rounded-t-[4px] ${isActive || picked === d.day ? 'bg-red-700' : d.day === data.today ? 'bg-red-500' : 'bg-red-400'}`}
                        style={{ height: d.qty > 0 ? Math.max(h, 2) : 0 }}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Eje X: días clave para que no se amontone en celular */}
            <div className="flex gap-[2px] mt-1 text-[10px] text-slate-400 tabular-nums">
              {data.days.map((d) => (
                <span key={d.day} className={`flex-1 text-center ${d.day === data.today ? 'font-semibold text-slate-700' : ''}`}>
                  {d.day === 1 || d.day % 5 === 0 || d.day === data.today ? d.day : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {data && (
        <details ref={tableRef} className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">Ver tabla</summary>
          <div className="mt-2 grid gap-x-6 gap-y-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <table className="w-full tabular-nums self-start">
              <tbody>
                {past.slice().reverse().map((d) => (
                  <tr
                    key={d.day}
                    onClick={() => pick(d.day)}
                    className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${picked === d.day ? 'bg-red-50 text-slate-800 font-medium' : ''}`}
                  >
                    <td className="py-1 pl-1">{d.day} {mon}</td>
                    <td className="text-right">{d.qty} u.</td>
                    <td className="text-right pr-1">{fmt(d.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Productos chinos vendidos: del mes, o del día elegido */}
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 pb-1">
                <span className="font-medium text-slate-700">
                  {picked == null ? `Productos del mes` : `Productos del ${picked} ${mon}`}
                </span>
                {picked != null && (
                  <button type="button" onClick={() => setPicked(null)} className="text-slate-400 hover:text-slate-700">
                    Ver mes
                  </button>
                )}
              </div>
              {prods.length === 0 ? (
                <p className="py-2 text-slate-400 border-t border-slate-100">Sin ventas chinas ese día</p>
              ) : (
                <ul>
                  {prods.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5 border-t border-slate-100">
                      {p.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.thumbnail} alt="" className="w-7 h-7 rounded-md object-cover flex-shrink-0 bg-slate-100 border border-slate-200" />
                      ) : (
                        <div className="w-7 h-7 rounded-md flex-shrink-0 bg-slate-100 border border-slate-200" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-slate-700" title={p.title}>{stripColor(p.title, p.color)}</div>
                        {p.color && <div className="text-[11px] text-slate-400">{p.color}</div>}
                      </div>
                      <div className="text-right tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{p.qty} u.</div>
                        <div className="text-[11px] text-slate-400">{fmt(p.revenue)}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
