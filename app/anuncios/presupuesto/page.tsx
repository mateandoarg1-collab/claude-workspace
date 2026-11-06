'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';

// Ajuste diario de presupuesto por campaña según ROAS/CPA de ayer en Meta (ver lib/ajustePresupuesto.ts).
type Config = { subirRoas: number; subirCpa: number; bajarCpa: number; paso: number };
type Item = {
  id: string; nombre: string; tipo: string; gasto: number; compras: number; roas: number | null; cpa: number | null;
  accion: 'subir' | 'bajar' | 'mantener'; motivo: string; antes: number; despues: number; error?: string;
};
type Hist = { dia: string; roas: number | null; cpa: number | null; accion: string; nombre: string; antes: number; despues: number; error: string; motivo: string };
type Estado = { k: number; dia: string; config: Config | null; items: Item[]; historial: Hist[]; error: string };

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const inp = 'w-24 rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5 text-sm';
const DEF: Config = { subirRoas: 10, subirCpa: 14000, bajarCpa: 20000, paso: 10 };
const fecha = (d: string) => d.split('-').reverse().join('/');
const COLOR = { subir: 'text-emerald-300', bajar: 'text-amber-400', mantener: 'text-slate-500' } as const;

export default function PresupuestoPage() {
  const [recarga, setRecarga] = useState(0);
  const [est, setEst] = useState<Estado | null>(null);
  const [form, setForm] = useState<Config>(DEF);
  const [ocupado, setOcupado] = useState(false);
  const cargando = est?.k !== recarga;

  useEffect(() => {
    fetch('/api/anuncios/presupuesto').then((r) => r.json())
      .then((j) => {
        setEst({ k: recarga, dia: j.dia ?? '', config: j.config ?? null, items: j.items ?? [], historial: j.historial ?? [], error: j.error ?? '' });
        if (j.config) setForm(j.config);
      })
      .catch((e) => setEst({ k: recarga, dia: '', config: null, items: [], historial: [], error: String(e) }));
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

  const items = est?.items ?? [];
  const suben = items.filter((i) => i.accion === 'subir');
  const bajan = items.filter((i) => i.accion === 'bajar');

  async function guardar(c: Config | null) {
    if (c && !confirm(`Activar ajuste diario (10:00 hs), campaña por campaña con lo de ayer en Meta:\n\n• ROAS > ${c.subirRoas} o CPA < ${$(c.subirCpa)} → sube ${c.paso}%\n• CPA > ${$(c.bajarCpa)} (o gastó más que eso sin ventas) → baja ${c.paso}%\n• El resto no se toca. Sin topes.\n\n¿Seguimos?`)) return;
    if (!c && !confirm('¿Apagar el ajuste diario de presupuesto?')) return;
    await post({ config: c });
  }

  async function ajustarAhora() {
    if (!confirm(`¿Aplicar ahora? Suben ${suben.length} y bajan ${bajan.length} presupuesto(s) un ${est!.config!.paso}%.\n\nOjo: si el ajuste de hoy ya corrió, se aplica otra vez.`)) return;
    const r = await post({ ajustarAhora: true });
    if (!r.error) alert(`Listo: ${(r.items as Item[] | undefined)?.filter((i) => i.accion !== 'mantener' && !i.error).length ?? 0} presupuesto(s) cambiados.`);
  }

  const c = est?.config;
  const orden = [...items].sort((a, b) => ['subir', 'bajar', 'mantener'].indexOf(a.accion) - ['subir', 'bajar', 'mantener'].indexOf(b.accion) || b.gasto - a.gasto);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Presupuesto por ROAS" subtitle="Meta · Tienda Online · ajuste diario por campaña" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <h2 className="font-semibold">
            Ajuste automático{' '}
            <span className={`text-xs font-normal rounded-full px-2 py-0.5 ${c ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
              {cargando ? '…' : c ? 'Activo · todos los días 10:00' : 'Apagado'}
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="text-emerald-300">Sube</span> si ROAS &gt;
            <input type="number" step="0.1" className={inp} value={form.subirRoas} onChange={(e) => setForm({ ...form, subirRoas: Number(e.target.value) })} />
            o CPA &lt; $
            <input type="number" className={inp} value={form.subirCpa} onChange={(e) => setForm({ ...form, subirCpa: Number(e.target.value) })} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
            <span className="text-amber-400">Baja</span> si CPA &gt; $
            <input type="number" className={inp} value={form.bajarCpa} onChange={(e) => setForm({ ...form, bajarCpa: Number(e.target.value) })} />
            · un
            <input type="number" className={inp} value={form.paso} onChange={(e) => setForm({ ...form, paso: Number(e.target.value) })} />
            %
            <button className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 ml-auto"
              disabled={ocupado || cargando || !(form.subirRoas > 0 && form.subirCpa > 0 && form.bajarCpa >= form.subirCpa && form.paso > 0)
                || (!!c && c.subirRoas === form.subirRoas && c.subirCpa === form.subirCpa && c.bajarCpa === form.bajarCpa && c.paso === form.paso)}
              onClick={() => guardar(form)}>
              {c ? 'Cambiar' : 'Activar'}
            </button>
            {c && <button className="rounded-lg px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10" disabled={ocupado} onClick={() => guardar(null)}>Apagar</button>}
          </div>
          <p className="text-xs text-slate-500">
            Campaña por campaña, con lo que Meta atribuye del día anterior completo (gasto con recargo) en MATEANDO2 y MATEANDO 3 MP.
            En CBO mira y cambia la campaña; en ABO cada conjunto activo. Si gastó más que el CPA de bajada sin ninguna venta, también baja.
            Si cumple las dos (ROAS alto y CPA alto), sube. Sin topes. Cada cambio queda en la pestaña “ajuste_presupuesto” de la planilla del panel.
          </p>
          {est?.error && <p className="text-sm text-rose-400">{est.error}</p>}
        </section>

        {cargando && <p className="text-sm text-slate-400">Cargando…</p>}

        {!cargando && items.length > 0 && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold mr-auto">Con lo de ayer ({fecha(est!.dia)}): suben {suben.length}, bajan {bajan.length}, quedan {items.length - suben.length - bajan.length}</h2>
              {c && suben.length + bajan.length > 0 && (
                <button className="rounded-lg px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                  disabled={ocupado} onClick={ajustarAhora}>
                  {ocupado ? 'Aplicando…' : 'APLICAR AHORA'}
                </button>
              )}
            </div>
            {!c && <p className="text-xs text-slate-500">Simulación con los valores de arriba: mientras esté apagado no se cambia nada.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-slate-500 text-left">
                  <tr><th className="py-1 pr-3">Campaña / conjunto</th><th className="pr-3 text-right">Gasto</th><th className="pr-3 text-right">Compras</th><th className="pr-3 text-right">ROAS</th><th className="pr-3 text-right">CPA</th><th className="pr-3">Qué hace</th><th className="text-right">Presupuesto</th></tr>
                </thead>
                <tbody className="text-slate-300">
                  {orden.map((i) => (
                    <tr key={i.id} className="border-t border-slate-800">
                      <td className="py-1 pr-3">{i.nombre}{i.tipo === 'conjunto' && <span className="text-slate-500"> (conjunto)</span>}</td>
                      <td className="pr-3 text-right tabular-nums">{$(i.gasto)}</td>
                      <td className="pr-3 text-right tabular-nums">{i.compras}</td>
                      <td className="pr-3 text-right tabular-nums">{i.roas === null ? '—' : `${i.roas.toFixed(1)}x`}</td>
                      <td className="pr-3 text-right tabular-nums">{i.cpa === null ? '—' : $(i.cpa)}</td>
                      <td className={`pr-3 whitespace-nowrap ${COLOR[i.accion]}`}>{i.accion === 'subir' ? '▲ Sube' : i.accion === 'bajar' ? '▼ Baja' : '—'}</td>
                      <td className="text-right whitespace-nowrap tabular-nums">{i.accion === 'mantener' ? $(i.antes) : `${$(i.antes)} → ${$(i.despues)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {!cargando && !!est?.historial.length && (
          <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 overflow-x-auto">
            <h2 className="font-semibold mb-2">Historial</h2>
            <table className="w-full text-xs">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-1 pr-3">Día medido</th><th className="pr-3">Campaña</th><th className="pr-3">Motivo</th><th className="text-right">Presupuesto</th></tr>
              </thead>
              <tbody className="text-slate-300">
                {est.historial.map((h, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="py-1 pr-3 whitespace-nowrap">{fecha(h.dia)}</td>
                    <td className="pr-3">{h.nombre || 'Sin cambios'}{h.error && <span className="text-rose-400"> · {h.error}</span>}</td>
                    <td className="pr-3">{h.motivo}</td>
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
