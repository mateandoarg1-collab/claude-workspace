'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';

type Estado = 'impago' | 'sin_presentar' | 'hoy' | 'proximo' | 'pagado' | 'pasado';
type Vencimiento = { fecha: string; tipo: string; detalle: string; cuenta: string; monto: number; usd: number | null; estado: Estado };
type Transferencia = { fecha: string; cuenta: string; monto: number; detalle: string };
type Recordatorio = { fecha: string; detalle: string };
type Data = { actualizado: string; ultimoMail: string; hoy: string; vencimientos: Vencimiento[]; transferencias: Transferencia[]; recordatorios: Recordatorio[] };

const pesos = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const corto = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} mil` : pesos(n);
// En el calendario del celular no entra «$1,8 M»: «1,8M» / «791k».
const cortito = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : `${Math.max(1, Math.round(n / 1e3))}k`;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const diaSemana = (f: string) => DIAS[(new Date(f + 'T12:00:00Z').getUTCDay() + 6) % 7];
const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const sumarDias = (f: string, n: number) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

const ESTADO: Record<Estado, { nombre: string; punto: string; chip: string; prioridad: number }> = {
  impago: { nombre: 'Vencido impago', punto: 'bg-red-500', chip: 'bg-red-500/15 text-red-300 ring-red-500/30', prioridad: 0 },
  sin_presentar: { nombre: 'Cheque sin presentar', punto: 'bg-amber-400', chip: 'bg-amber-400/15 text-amber-200 ring-amber-400/30', prioridad: 1 },
  hoy: { nombre: 'Vence hoy', punto: 'bg-orange-400', chip: 'bg-orange-400/15 text-orange-200 ring-orange-400/30', prioridad: 2 },
  proximo: { nombre: 'Próximo', punto: 'bg-sky-400', chip: 'bg-sky-400/15 text-sky-200 ring-sky-400/30', prioridad: 3 },
  pagado: { nombre: 'Cobrado', punto: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30', prioridad: 4 },
  pasado: { nombre: 'Ya venció', punto: 'bg-slate-500', chip: 'bg-slate-700/40 text-slate-400 ring-slate-600/40', prioridad: 5 },
};
const TIPO: Record<string, string> = { cheque: 'e-Cheq', prestamo: 'Préstamo', tarjeta: 'Tarjeta', impuestos: 'Impuestos', otro: 'Otro' };

// El detalle viene como «Proveedor — e-Cheq 90000384»: el nombre va primero, lo demás abajo y más chico (sin repetir
// el tipo si el detalle ya lo dice).
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function Detalle({ v }: { v: Vencimiento }) {
  const [titulo, ...resto] = v.detalle.split(' — ');
  const tipo = TIPO[v.tipo] ?? v.tipo;
  const partes = [...(sinTildes(v.detalle).includes(sinTildes(tipo)) ? [] : [tipo]), ...resto];
  if (v.cuenta && !['DEPOSITADO', 'PRESENTADO', 'ACTIVO', 'sin dato'].includes(v.cuenta)) partes.push(v.cuenta);
  return (
    <div className="min-w-0">
      <div className="font-medium truncate">{titulo}</div>
      <div className="text-xs text-slate-500 truncate">{partes.join(' · ')}</div>
    </div>
  );
}

export default function Vencimientos() {
  const [res, setRes] = useState<{ data?: Data; err?: string } | null>(null);
  const [mes, setMes] = useState(() => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7));
  const [elegido, setElegido] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch('/api/vencimientos', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setRes(d.error ? { err: d.error } : { data: d }))
      .catch((e) => vivo && setRes({ err: String(e) }));
    return () => {
      vivo = false;
    };
  }, []);

  const d = res?.data;
  const porDia = new Map<string, Vencimiento[]>();
  for (const v of d?.vencimientos ?? []) porDia.set(v.fecha, [...(porDia.get(v.fecha) ?? []), v]);
  const recPorDia = new Map<string, Recordatorio[]>();
  for (const r of d?.recordatorios ?? []) recPorDia.set(r.fecha, [...(recPorDia.get(r.fecha) ?? []), r]);
  const hoy = d?.hoy ?? '';
  // Día abierto: el que tocó, o hoy si tiene algo, o el próximo con vencimientos.
  const proximoConAlgo = [...porDia.keys()].filter((f) => f >= hoy).sort()[0];
  const dia = elegido ?? (porDia.has(hoy) ? hoy : proximoConAlgo ?? hoy);

  const suma = (f: (v: Vencimiento) => boolean) => (d?.vencimientos ?? []).filter(f).reduce((s, v) => s + v.monto, 0);
  const fin7 = hoy ? sumarDias(hoy, 7) : '';
  const tarjetas = [
    { titulo: 'Vencido impago', valor: suma((v) => v.estado === 'impago' || v.estado === 'sin_presentar'), color: 'text-red-300', nota: 'el banco debita o el cheque se puede cobrar' },
    { titulo: 'Vence hoy', valor: suma((v) => v.estado === 'hoy'), color: 'text-orange-200', nota: hoy ? `${diaSemana(hoy)} ${ddmm(hoy)}` : '' },
    { titulo: 'Próximos 7 días', valor: suma((v) => v.fecha > hoy && v.fecha <= fin7), color: 'text-sky-200', nota: 'según los mails hasta hoy' },
    { titulo: `Resto de ${MESES[Number(hoy.slice(5, 7)) - 1] ?? 'mes'}`, valor: suma((v) => v.fecha > fin7 && v.fecha.slice(0, 7) === hoy.slice(0, 7)), color: 'text-slate-100', nota: 'lo ya anunciado' },
  ];

  // Calendario del mes: semanas de lunes a domingo.
  const primero = new Date(mes + '-01T12:00:00Z');
  const desfase = (primero.getUTCDay() + 6) % 7;
  const diasMes = new Date(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + 1, 0)).getUTCDate();
  const celdas: (string | null)[] = [...Array(desfase).fill(null), ...Array.from({ length: diasMes }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`)];
  while (celdas.length % 7) celdas.push(null);
  const mover = (n: number) => {
    const f = new Date(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + n, 1));
    setMes(f.toISOString().slice(0, 7));
  };
  const totalMes = (d?.vencimientos ?? []).filter((v) => v.fecha.slice(0, 7) === mes).reduce((s, v) => s + v.monto, 0);
  const delDia = [...(porDia.get(dia) ?? [])].sort((a, b) => ESTADO[a.estado].prioridad - ESTADO[b.estado].prioridad || b.monto - a.monto);

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader
        title="Vencimientos"
        subtitle={d ? `Mails de Mateando Datos · último del ${diaSemana(d.ultimoMail)} ${ddmm(d.ultimoMail)}` : 'Mails de Mateando Datos'}
        width="5xl"
      />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {res?.err && <p className="text-sm text-red-400">{res.err}</p>}
        {!res && <p className="text-sm text-slate-400">Cargando…</p>}
        {d && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {tarjetas.map((t) => (
                <div key={t.titulo} className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
                  <div className="text-xs text-slate-400">{t.titulo}</div>
                  <div className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 ${t.color}`}>{t.valor ? corto(t.valor) : '—'}</div>
                  <div className="text-[11px] text-slate-500 mt-1">{t.nota}</div>
                </div>
              ))}
            </div>

            {d.transferencias.length > 0 && (
              <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
                <h2 className="text-lg font-semibold mb-3">Transferencias desde Mercado Pago</h2>
                <ul className="divide-y divide-slate-800">
                  {d.transferencias.map((t) => (
                    <li key={t.fecha + t.cuenta + t.monto} className={`py-2.5 flex items-center justify-between gap-3 text-sm ${t.fecha < hoy ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <div className="font-medium">
                          {diaSemana(t.fecha)} {ddmm(t.fecha)} · a {t.cuenta}
                          {t.fecha === hoy && <span className="ml-2 text-xs text-orange-300">hoy</span>}
                        </div>
                        <div className="text-xs text-slate-500 truncate">{t.detalle.replace(/^paga/, 'Para pagar')}</div>
                      </div>
                      <div className="font-bold tabular-nums shrink-0">{pesos(t.monto)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
              <div className="flex items-center justify-between gap-3 mb-4">
                <button onClick={() => mover(-1)} aria-label="Mes anterior" className="h-9 w-9 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800">‹</button>
                <div className="text-center">
                  <h2 className="text-lg font-semibold capitalize">{MESES[Number(mes.slice(5, 7)) - 1]} {mes.slice(0, 4)}</h2>
                  <div className="text-xs text-slate-500">{totalMes ? `${pesos(totalMes)} en vencimientos` : 'Sin vencimientos anunciados'}</div>
                </div>
                <button onClick={() => mover(1)} aria-label="Mes siguiente" className="h-9 w-9 rounded-lg border border-slate-800 text-slate-300 hover:bg-slate-800">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-slate-500 mb-1">
                {DIAS.map((n) => (
                  <div key={n}>{n}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {celdas.map((f, i) => {
                  if (!f) return <div key={i} />;
                  const vs = porDia.get(f) ?? [];
                  const total = vs.reduce((s, v) => s + v.monto, 0);
                  const peor = vs.reduce<Estado | null>((p, v) => (!p || ESTADO[v.estado].prioridad < ESTADO[p].prioridad ? v.estado : p), null);
                  const rec = recPorDia.has(f);
                  return (
                    <button
                      key={f}
                      onClick={() => setElegido(f)}
                      className={`min-h-14 sm:min-h-20 rounded-lg border p-1 sm:p-1.5 text-left flex flex-col transition-colors ${
                        f === dia ? 'border-emerald-500 bg-emerald-500/10' : 'border-slate-800 hover:bg-slate-800/60'
                      } ${f === hoy ? 'ring-1 ring-orange-400/60' : ''}`}
                    >
                      <span className="flex items-center justify-between gap-1">
                        <span className={`text-xs ${f === hoy ? 'text-orange-300 font-bold' : 'text-slate-400'}`}>{Number(f.slice(8))}</span>
                        {total > 0 && peor && <span className={`h-1.5 w-1.5 sm:h-2 sm:w-2 rounded-full shrink-0 ${ESTADO[peor].punto}`} />}
                      </span>
                      {total > 0 && (
                        <span className="mt-auto text-[10px] sm:text-xs font-semibold tabular-nums truncate">
                          <span className="sm:hidden">{cortito(total)}</span>
                          <span className="hidden sm:inline">{corto(total)}</span>
                        </span>
                      )}
                      {rec && !total && (
                        <span className="mt-auto text-[10px] text-amber-300 truncate">
                          <span className="sm:hidden">aviso</span>
                          <span className="hidden sm:inline">recordatorio</span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-400">
                {(Object.keys(ESTADO) as Estado[]).map((e) => (
                  <span key={e} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${ESTADO[e].punto}`} />
                    {ESTADO[e].nombre}
                  </span>
                ))}
              </div>
            </section>

            <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-3 capitalize">
                {diaSemana(dia)} {ddmm(dia)}
                {dia === hoy && <span className="ml-2 text-sm font-normal text-orange-300 normal-case">hoy</span>}
              </h2>
              {(recPorDia.get(dia) ?? []).map((r) => (
                <p key={r.detalle} className="text-sm text-amber-200 bg-amber-400/10 rounded-lg px-3 py-2 mb-3">{r.detalle}</p>
              ))}
              {delDia.length ? (
                <ul className="divide-y divide-slate-800">
                  {delDia.map((v) => (
                    <li key={v.detalle + v.monto} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                      <Detalle v={v} />
                      <div className="text-right shrink-0">
                        <div className="font-bold tabular-nums">{pesos(v.monto)}</div>
                        {v.usd ? <div className="text-xs text-slate-400 tabular-nums">+ US$ {v.usd.toLocaleString('es-AR')}</div> : null}
                        <span className={`inline-block mt-1 text-[11px] rounded-full px-2 py-0.5 ring-1 ${ESTADO[v.estado].chip}`}>{ESTADO[v.estado].nombre}</span>
                      </div>
                    </li>
                  ))}
                  {delDia.length > 1 && (
                    <li className="py-2.5 flex justify-between text-sm font-semibold">
                      <span>Total del día</span>
                      <span className="tabular-nums">{pesos(delDia.reduce((s, v) => s + v.monto, 0))}</span>
                    </li>
                  )}
                </ul>
              ) : (
                !recPorDia.has(dia) && <p className="text-sm text-slate-500">Sin vencimientos ese día.</p>
              )}
            </section>

            <p className="text-xs text-slate-500">
              Sale de los mails que Francisco manda lunes y jueves a jpcipolletta@mateando.com (Mercado Pago, BBVA y Banco Nación; no incluye el
              detalle de consumos de tarjeta). Cada mail anuncia solo los próximos días, así que los meses que vienen se completan a medida que
              llegan. «Ya venció» = el último mail no lo nombra (se asume pagado o debitado).
            </p>
          </>
        )}
      </main>
    </div>
  );
}
