'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';

// Ajuste diario de presupuesto por ROAS (ver lib/ajustePresupuesto.ts).
type Config = { subirSi: number; bajarSi: number; paso: number };
type Cambio = { nombre: string; antes: number; despues: number; error?: string };
type Previa = { dia: string; ventas: number | null; gasto: number; roas: number | null; accion: string; cambios: Cambio[] };
type Activo = { cuenta: string; id: string; nombre: string; tipo: string; diario: number };
type Hist = { dia: string; corrido: string; roas: number | null; ventas: number; gasto: number; accion: string; nombre: string; antes: number; despues: number; error: string };
type Estado = { k: number; config: Config | null; previa: Previa | null; activos: Activo[]; historial: Hist[]; error: string };

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const inp = 'w-20 rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-sm';
const ACCION: Record<string, string> = { subir: 'Sube', bajar: 'Baja', mantener: 'No cambia', 'sin datos': 'Sin datos' };

export default function PresupuestoPage() {
  const [recarga, setRecarga] = useState(0);
  const [est, setEst] = useState<Estado | null>(null);
  const [form, setForm] = useState<Config>({ subirSi: 10, bajarSi: 8, paso: 10 });
  const [ocupado, setOcupado] = useState(false);
  const cargando = est?.k !== recarga;

  useEffect(() => {
    fetch('/api/anuncios/presupuesto').then((r) => r.json())
      .then((j) => {
        setEst({ k: recarga, config: j.config ?? null, previa: j.previa ?? null, activos: j.activos ?? [], historial: j.historial ?? [], error: j.error ?? '' });
        if (j.config) setForm(j.config);
      })
      .catch((e) => setEst({ k: recarga, config: null, previa: null, activos: [], historial: [], error: String(e) }));
  }, [recarga]);

  async function post(body: unknown) {
    setOcupado(true);
    const r = await fetch('/api/anuncios/presupuesto', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    await new Promise((res) => setTimeout(res, 4000)); // Meta tarda unos segundos en reflejar los cambios
    setOcupado(false);
    if (r.error) alert(`Error: ${r.error}`);
    setRecarga((n) => n + 1);
    return r;
  }

  async function guardar(c: Config | null) {
    if (c && !confirm(`Activar ajuste diario (10:00 hs):\n\n• ROAS de ayer ≥ ${c.subirSi} → sube ${c.paso}% el presupuesto de todas las campañas activas\n• ROAS de ayer < ${c.bajarSi} → baja ${c.paso}%\n• En el medio no se toca\n\nROAS = ventas Tienda Online (Empretienda) ÷ gasto Meta MATEANDO2 + MATEANDO 3 MP (con recargo). Sin topes.\n\n¿Seguimos?`)) return;
    if (!c && !confirm('¿Apagar el ajuste diario de presupuesto?')) return;
    await post({ config: c });
  }

  async function ajustarAhora() {
    const p = est?.previa;
    if (!p || p.accion === 'mantener' || p.accion === 'sin datos') return;
    if (!confirm(`¿${p.accion === 'subir' ? 'Subir' : 'Bajar'} ahora ${est!.config!.paso}% el presupuesto de ${p.cambios.length} campaña(s)/conjunto(s)?\n\nOjo: si el ajuste de hoy ya corrió, se aplica otra vez.`)) return;
    const r = await post({ ajustarAhora: true });
    if (!r.error) alert(`Listo: ${r.cambios?.filter((c: Cambio) => !c.error).length ?? 0} presupuesto(s) cambiados.`);
  }

  const c = est?.config;
  const p = est?.previa;
  const totalDiario = (est?.activos ?? []).reduce((s, a) => s + a.diario, 0);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Presupuesto por ROAS" subtitle="Meta · Tienda Online · ajuste diario" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold mr-auto">
              Ajuste automático{' '}
              <span className={`text-xs font-normal rounded-full px-2 py-0.5 ${c ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                {cargando ? '…' : c ? 'Activo · todos los días 10:00' : 'Apagado'}
              </span>
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            Si el ROAS de ayer es ≥
            <input type="number" step="0.1" className={inp} value={form.subirSi} onChange={(e) => setForm({ ...form, subirSi: Number(e.target.value) })} />
            sube, si es &lt;
            <input type="number" step="0.1" className={inp} value={form.bajarSi} onChange={(e) => setForm({ ...form, bajarSi: Number(e.target.value) })} />
            baja, un
            <input type="number" className={inp} value={form.paso} onChange={(e) => setForm({ ...form, paso: Number(e.target.value) })} />
            %.
            <button className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 ml-auto"
              disabled={ocupado || cargando || !(form.subirSi > 0 && form.bajarSi > 0 && form.paso > 0 && form.bajarSi <= form.subirSi)
                || (!!c && c.subirSi === form.subirSi && c.bajarSi === form.bajarSi && c.paso === form.paso)}
              onClick={() => guardar(form)}>
              {c ? 'Cambiar' : 'Activar'}
            </button>
            {c && <button className="rounded-lg px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10" disabled={ocupado} onClick={() => guardar(null)}>Apagar</button>}
          </div>
          <p className="text-xs text-slate-500">
            ROAS = ventas de la Tienda Online en Empretienda (sin Acordar) ÷ gasto de Meta en MATEANDO2 + MATEANDO 3 MP (con recargo), del día anterior completo.
            Mueve igual todas las campañas activas: en CBO el presupuesto de la campaña, en ABO el de cada conjunto activo. Sin topes. Cada cambio queda en la pestaña “ajuste_presupuesto” de la planilla del panel.
          </p>
          {est?.error && <p className="text-sm text-rose-400">{est.error}</p>}
        </section>

        {cargando && <p className="text-sm text-slate-400">Cargando…</p>}

        {!cargando && p && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            <h2 className="font-semibold">Ayer ({p.dia.split('-').reverse().join('/')})</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
              {[
                ['Ventas Tienda Online', p.ventas === null ? 'sin dato' : $(p.ventas)],
                ['Gasto Meta (c/recargo)', $(p.gasto)],
                ['ROAS', p.roas === null ? '—' : `${p.roas.toFixed(2)}x`],
                ['Presupuesto diario activo', $(totalDiario)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2">
                  <p className="text-xs text-slate-500">{l}</p><p className="font-semibold">{v}</p>
                </div>
              ))}
            </div>
            {c && (
              <div className="flex flex-wrap items-center gap-2">
                <p className={`text-sm ${p.accion === 'subir' ? 'text-emerald-300' : p.accion === 'bajar' ? 'text-amber-400' : 'text-slate-400'}`}>
                  {p.accion === 'subir' ? `Con este ROAS, a las 10:00 sube ${c.paso}%` : p.accion === 'bajar' ? `Con este ROAS, a las 10:00 baja ${c.paso}%`
                    : p.accion === 'sin datos' ? 'Todavía no hay ventas de ayer leídas de Empretienda' : 'Con este ROAS no se toca el presupuesto'}
                </p>
                {(p.accion === 'subir' || p.accion === 'bajar') && (
                  <button className={`rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 ${p.accion === 'subir' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'}`}
                    disabled={ocupado} onClick={ajustarAhora}>
                    {ocupado ? 'Aplicando…' : p.accion === 'subir' ? 'SUBIR AHORA' : 'BAJAR AHORA'}
                  </button>
                )}
              </div>
            )}
            {c && p.cambios.length > 0 && (
              <ul className="text-xs text-slate-300 space-y-0.5">
                {p.cambios.map((x, i) => <li key={i}>• {x.nombre}: {$(x.antes)} → {$(x.despues)}</li>)}
              </ul>
            )}
          </section>
        )}

        {!cargando && !!est?.activos.length && (!c || !p?.cambios.length) && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
            <h2 className="font-semibold mb-2">Presupuestos diarios activos</h2>
            <ul className="text-xs text-slate-300 space-y-0.5">
              {est.activos.map((a) => <li key={a.id}>• {a.nombre} ({a.tipo}): {$(a.diario)}</li>)}
            </ul>
          </section>
        )}

        {!cargando && !!est?.historial.length && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 overflow-x-auto">
            <h2 className="font-semibold mb-2">Historial</h2>
            <table className="w-full text-xs">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-1 pr-3">Día medido</th><th className="pr-3">ROAS</th><th className="pr-3">Acción</th><th className="pr-3">Campaña</th><th className="text-right">Presupuesto</th></tr>
              </thead>
              <tbody className="text-slate-300">
                {est.historial.map((h, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="py-1 pr-3 whitespace-nowrap">{h.dia.split('-').reverse().join('/')}</td>
                    <td className="pr-3">{h.roas?.toFixed(2) ?? '—'}x</td>
                    <td className="pr-3">{ACCION[h.accion] ?? h.accion}</td>
                    <td className="pr-3">{h.nombre || '—'}{h.error && <span className="text-rose-400"> · {h.error}</span>}</td>
                    <td className="text-right whitespace-nowrap">{h.antes ? `${$(h.antes)} → ${$(h.despues)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
