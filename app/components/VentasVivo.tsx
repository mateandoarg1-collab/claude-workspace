'use client';

import { useEffect, useState } from 'react';

type V = { t: string; canal: 'empretienda' | 'meli'; monto: number; cobrada: boolean; medio: string; producto: string };
type D = { desde: string; ahora: string; ventas: V[]; empretiendaUltima: string | null; errores: Record<string, string | null> };

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' });
const KEY = 'vivo-desde-2';

// "HH:MM" de hoy (hora AR) → ISO
function isoHoy(hhmm: string) {
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  return new Date(`${hoy}T${hhmm}:00-03:00`).toISOString();
}

export default function VentasVivo() {
  const [abierto, setAbierto] = useState(true);
  const [inicio, setInicio] = useState('20:36');
  const [fin, setFin] = useState('21:38'); // vacío = sigue en vivo
  const [d, setD] = useState<D | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { try { const g = localStorage.getItem(KEY); if (g) setInicio(g); } catch {} }, []);

  useEffect(() => {
    if (!/^\d\d:\d\d$/.test(inicio)) return;
    try { localStorage.setItem(KEY, inicio); } catch {}
    let vivo = true;
    const cargar = () =>
      fetch(`/api/vivo?desde=${encodeURIComponent(isoHoy(inicio))}${/^\d\d:\d\d$/.test(fin) ? `&hasta=${encodeURIComponent(isoHoy(fin))}:59` : ''}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((x) => { if (vivo) { if (x.error) setErr(x.error); else { setD(x); setErr(''); } } })
        .catch((e) => vivo && setErr(String(e)));
    cargar();
    const t = setInterval(cargar, 2 * 60e3);
    return () => { vivo = false; clearInterval(t); };
  }, [inicio, fin]);

  const v = d?.ventas ?? [];
  const suma = (l: V[]) => l.reduce((s, x) => s + x.monto, 0);
  const cob = v.filter((x) => x.cobrada);
  const pen = v.filter((x) => !x.cobrada);
  const min = d ? Math.max(1, (Math.min(new Date(d.ahora).getTime(), /^\d\d:\d\d$/.test(fin) ? new Date(isoHoy(fin)).getTime() : Infinity) - new Date(d.desde).getTime()) / 60000) : 1;
  const ult15 = d ? v.filter((x) => new Date(x.t).getTime() > new Date(d.ahora).getTime() - 15 * 60e3) : [];

  return (
    <section className="rounded-xl border border-rose-500/40 bg-gradient-to-br from-rose-950/40 to-slate-900 p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => setAbierto(!abierto)} className="font-semibold text-rose-300 flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" /></span>
          Ventas vivo {abierto ? '▾' : '▸'}
        </button>
        <label className="text-sm text-slate-400 flex items-center gap-2">
          Arrancó a las
          <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-100" />
        </label>
        <label className="text-sm text-slate-400 flex items-center gap-2">
          Terminó a las
          <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-100" />
        </label>
        <span className="text-xs text-slate-500 ml-auto">{d ? `actualizado ${hora(d.ahora)} · se refresca cada 2 min` : err ? '' : 'Cargando…'}</span>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {abierto && d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Tile titulo="Total Tienda desde el vivo" valor={fmt(suma(v))} sub={`${v.length} pedidos · ${fmt(suma(v) / min * 60)}/hora`} grande />
            <Tile titulo="✅ ABONADAS" valor={fmt(suma(cob))} sub={`${cob.length} pedidos (MP, GoCuotas o transferencia tildada)`} verde />
            <Tile titulo="⏳ PENDIENTES" valor={fmt(suma(pen))} sub={`${pen.length} pedidos (transferencia sin tildar o esperando pago)`} ambar />
            <Tile titulo="Últimos 15 min" valor={fmt(suma(ult15))} sub={`${ult15.length} pedidos`} />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <tbody>
                {v.map((x, i) => (
                  <tr key={i} className="border-b border-slate-800/60 last:border-0">
                    <td className="px-3 py-1.5 tabular-nums text-slate-400">{hora(x.t)}</td>
                                        <td className="px-2 py-1.5 text-slate-300 truncate max-w-[16rem] hidden sm:table-cell">{x.producto}</td>
                    <td className="px-2 py-1.5 text-xs"><span className={x.cobrada ? 'text-emerald-400' : 'text-amber-400'}>{x.medio} · {x.cobrada ? 'ABONADA' : 'PENDIENTE'}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmt(x.monto)}</td>
                  </tr>
                ))}
                {!v.length && <tr><td className="px-3 py-3 text-slate-500">Todavía no entró nada desde las {inicio}.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Pedidos hechos durante el vivo: las transferencias que llegan después pasan solas de PENDIENTE a ABONADA. Solo Tienda Online (Empretienda), sin local «a acordar» ni cancelados. El servidor lee Empretienda cada 30 min
            {d.empretiendaUltima ? ` (última orden leída ${hora(d.empretiendaUltima)})` : ''}.
            {d.errores.empretienda && <span className="text-red-400"> Tienda: {d.errores.empretienda}</span>}
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ titulo, valor, sub, grande, verde, ambar }: { titulo: string; valor: string; sub: string; grande?: boolean; verde?: boolean; ambar?: boolean }) {
  return (
    <div className={`rounded-lg bg-slate-900/80 border p-3 ${grande ? 'border-rose-500/50' : 'border-slate-800'}`}>
      <div className="text-xs text-slate-400">{titulo}</div>
      <div className={`font-bold tabular-nums ${grande ? 'text-2xl text-rose-200' : verde ? 'text-xl text-emerald-300' : ambar ? 'text-xl text-amber-300' : 'text-xl text-slate-100'}`}>{valor}</div>
      <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}
