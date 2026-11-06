'use client';

import { useEffect, useState } from 'react';

// Apartado "Apagado automático por CPA" de la cuenta elegida (ver lib/cpaMax.ts).
type Decision = { id: string; nombre: string; gasto: number; compras: number; cpa: number | null; motivo: string };
type Apagado = { id: string; nombre: string; campana: string; miniatura: string | null; estado: string };
type Estado = { cuenta: string; cpaMax: number | null; apagados: Apagado[]; seApagarian: Decision[]; error: string };

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;

export default function CpaMax({ cuenta, nombreCuenta }: { cuenta: string; nombreCuenta: string }) {
  const [est, setEst] = useState<Estado | null>(null);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const cargando = !!cuenta && est?.cuenta !== `${cuenta}|${recarga}`;

  useEffect(() => {
    if (!cuenta) return;
    const k = `${cuenta}|${recarga}`;
    fetch(`/api/anuncios/cpa-max?cuenta=${cuenta}`).then((r) => r.json())
      .then((j) => {
        setEst({ cuenta: k, cpaMax: j.cpaMax ?? null, apagados: j.apagados ?? [], seApagarian: j.seApagarian ?? [], error: j.error ?? '' });
        setValor(j.cpaMax ? String(j.cpaMax) : '');
      })
      .catch((e) => setEst({ cuenta: k, cpaMax: null, apagados: [], seApagarian: [], error: String(e) }));
  }, [cuenta, recarga]);

  async function guardar(nuevo: number | null) {
    if (nuevo) {
      // Antes de activar: avisar cuántos anuncios se apagarían ya mismo con ese valor.
      setGuardando(true);
      const r = await fetch(`/api/anuncios/cpa-max?cuenta=${cuenta}&probar=${nuevo}`).then((x) => x.json());
      setGuardando(false);
      const lista: Decision[] = r.seApagarian ?? [];
      const detalle = lista.length
        ? `\n\nCon ese valor se apagan YA ${lista.length} anuncio(s):\n${lista.slice(0, 8).map((d) => `• ${d.nombre} — ${d.motivo}`).join('\n')}${lista.length > 8 ? '\n…' : ''}`
        : '\n\nCon ese valor hoy no se apagaría ningún anuncio.';
      if (!confirm(`Activar apagado automático en ${nombreCuenta} con CPA máximo ${$(nuevo)}.\n\nCada 30 min se pausan los anuncios activos que en los últimos 3 días tengan CPA mayor, o que hayan gastado más que eso sin ventas.${detalle}\n\n¿Seguimos?`)) return;
    } else if (!confirm(`¿Desactivar el apagado automático en ${nombreCuenta}?`)) return;
    setGuardando(true);
    await fetch('/api/anuncios/cpa-max', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cuenta, cpaMax: nuevo }) });
    setGuardando(false);
    setRecarga((n) => n + 1);
  }

  const activo = !!est?.cpaMax;
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold mr-auto">
          Apagado automático por CPA{' '}
          <span className={`text-xs font-normal rounded-full px-2 py-0.5 ${activo ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
            {cargando ? '…' : activo ? `Activo · máx ${$(est!.cpaMax!)}` : 'Desactivado'}
          </span>
        </h2>
        <span className="text-sm text-slate-400">CPA máximo $</span>
        <input type="number" className="w-32 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm" placeholder="ej. 15000"
          value={valor} onChange={(e) => setValor(e.target.value)} />
        <button className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
          disabled={guardando || !(Number(valor) > 0) || Number(valor) === est?.cpaMax} onClick={() => guardar(Number(valor))}>
          {activo ? 'Cambiar' : 'Activar'}
        </button>
        {activo && (
          <button className="rounded-lg px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10" disabled={guardando} onClick={() => guardar(null)}>Desactivar</button>
        )}
      </div>
      <p className="text-xs text-slate-500">
        Cada 30 min revisa los anuncios activos de esta cuenta (últimos 3 días, gasto con recargo). Se pausan si el CPA supera el máximo,
        o si gastaron más que el máximo sin ninguna venta. Quedan con la etiqueta “Apagado por CPA” en el Administrador.
      </p>
      {est?.error && <p className="text-sm text-rose-400">{est.error}</p>}

      {!cargando && activo && est!.seApagarian.length > 0 && (
        <div>
          <p className="text-xs text-amber-400 mb-1">En el próximo control se apagan {est!.seApagarian.length}:</p>
          <ul className="text-xs text-slate-300 space-y-0.5">
            {est!.seApagarian.slice(0, 10).map((d) => <li key={d.id}>• {d.nombre} — {d.motivo}</li>)}
          </ul>
        </div>
      )}

      {!cargando && est!.apagados.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 mb-2">Apagados por CPA ({est!.apagados.length}):</p>
          <div className="flex flex-wrap gap-2">
            {est!.apagados.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-800 pr-2 max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.miniatura ? <img src={a.miniatura} alt="" referrerPolicy="no-referrer" className="w-10 h-10 object-cover rounded-l-lg" /> : <div className="w-10 h-10" />}
                <div className="min-w-0">
                  <p className="text-xs truncate">{a.nombre}</p>
                  <p className="text-[10px] text-slate-500 truncate">{a.estado === 'ACTIVE' ? 'Reactivado a mano' : 'Pausado'} · {a.campana}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
