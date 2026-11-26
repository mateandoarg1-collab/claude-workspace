'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';

// Campañas activas de Meta con CPA máximo por campaña (ver lib/cpaCampanas.ts): pasadas 48 h de gasto,
// el anuncio que no convierte por debajo del CPA máx de su campaña se apaga solo.

type Dec = { id: string; nombre: string; gasto: number; compras: number; cpa: number | null; primerDia: string; motivo: string };
type Campana = {
  id: string; nombre: string; presupuestoDiario: number | null; gasto: number; compras: number; cpa: number | null;
  cpaMax: number | null; seApagarian: Dec[]; enEspera: Dec[]; anunciosActivos: number;
};
type Cuenta = { id: string; nombre: string };

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const sel = 'rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100';

function Fila({ c, cuenta, alGuardar }: { c: Campana; cuenta: string; alGuardar: () => void }) {
  const [valor, setValor] = useState(c.cpaMax ? String(c.cpaMax) : '');
  const [guardando, setGuardando] = useState(false);

  async function guardar(nuevo: number | null) {
    if (nuevo) {
      if (!confirm(
        `CPA máximo ${$(nuevo)} para «${c.nombre}».\n\n` +
        'Cada 30 min se revisan sus anuncios activos: si ya llevan 48 h gastando y en los últimos 7 días tienen CPA mayor, ' +
        `o gastaron más que ${$(nuevo)} sin ventas, se apagan solos.\n\n¿Seguimos?`,
      )) return;
    } else if (!confirm(`¿Sacar el CPA máximo de «${c.nombre}»?`)) return;
    setGuardando(true);
    const r = await fetch('/api/anuncios/campanas', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cuenta, campana: c.id, nombre: c.nombre, cpaMax: nuevo }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setGuardando(false);
    if (r.error) alert(`Error: ${r.error}`);
    alGuardar();
  }

  const activo = !!c.cpaMax;
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{c.nombre}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {c.presupuestoDiario ? `${$(c.presupuestoDiario)}/día · ` : ''}{c.anunciosActivos} anuncios activos
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right text-sm">
          <div><p className="text-[10px] uppercase text-slate-500">Gasto 7d</p><p className="font-semibold tabular-nums">{$(c.gasto)}</p></div>
          <div><p className="text-[10px] uppercase text-slate-500">Ventas</p><p className="font-semibold tabular-nums">{c.compras}</p></div>
          <div>
            <p className="text-[10px] uppercase text-slate-500">CPA</p>
            <p className={`font-semibold tabular-nums ${c.cpaMax && c.cpa && c.cpa > c.cpaMax ? 'text-rose-400' : ''}`}>{c.cpa === null ? '—' : $(c.cpa)}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs rounded-full px-2 py-0.5 ${activo ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
          {activo ? `Control activo · máx ${$(c.cpaMax!)}` : 'Sin CPA máximo'}
        </span>
        <span className="text-sm text-slate-400 ml-auto">CPA máx $</span>
        <input type="number" className={`${sel} w-28`} placeholder="ej. 15000" value={valor} onChange={(e) => setValor(e.target.value)} />
        <button className="rounded-lg px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
          disabled={guardando || !(Number(valor) > 0) || Number(valor) === c.cpaMax} onClick={() => guardar(Number(valor))}>
          {guardando ? '…' : activo ? 'Cambiar' : 'Guardar'}
        </button>
        {activo && <button className="rounded-lg px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10" disabled={guardando} onClick={() => guardar(null)}>Sacar</button>}
      </div>
      {activo && c.seApagarian.length > 0 && (
        <div className="text-xs">
          <p className="text-amber-400">En el próximo control se apagan {c.seApagarian.length}:</p>
          <ul className="text-slate-300 space-y-0.5 mt-0.5">{c.seApagarian.map((d) => <li key={d.id}>• {d.nombre} — {d.motivo}</li>)}</ul>
        </div>
      )}
      {activo && c.enEspera.length > 0 && (
        <div className="text-xs">
          <p className="text-slate-400">Van mal pero todavía no cumplen 48 h de gasto ({c.enEspera.length}):</p>
          <ul className="text-slate-500 space-y-0.5 mt-0.5">{c.enEspera.map((d) => <li key={d.id}>• {d.nombre} — {d.motivo}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export default function CampanasPage() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuenta, setCuenta] = useState('');
  const [recarga, setRecarga] = useState(0);
  const clave = `${cuenta}|${recarga}`;
  const [res, setRes] = useState<{ clave: string; campanas: Campana[]; error: string }>({ clave: '', campanas: [], error: '' });
  const [apagando, setApagando] = useState(false);
  const cargando = !!cuenta && res.clave !== clave;

  useEffect(() => {
    fetch('/api/anuncios/cuentas').then((r) => r.json()).then((j) => {
      setCuentas(j.cuentas ?? []);
      if (j.cuentas?.[0]) setCuenta(j.cuentas[0].id);
    });
  }, []);

  useEffect(() => {
    if (!cuenta) return;
    const k = `${cuenta}|${recarga}`;
    fetch(`/api/anuncios/campanas?cuenta=${cuenta}`).then((r) => r.json())
      .then((j) => setRes({ clave: k, campanas: j.campanas ?? [], error: j.error ?? '' }))
      .catch((e) => setRes({ clave: k, campanas: [], error: String(e) }));
  }, [cuenta, recarga]);

  const lista = cargando ? [] : res.campanas;
  const pendientes = lista.reduce((s, c) => s + (c.cpaMax ? c.seApagarian.length : 0), 0);

  async function apagarAhora() {
    if (!confirm(`¿Apagar ahora ${pendientes} anuncio(s) que superan el CPA máximo de su campaña?`)) return;
    setApagando(true);
    const r = await fetch('/api/anuncios/campanas', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cuenta, apagarAhora: true }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    await new Promise((ok) => setTimeout(ok, 3000)); // Meta tarda unos segundos en reflejarlo
    setApagando(false);
    alert(r.error ? `Error: ${r.error}` : `Listo: se apagaron ${r.apagados?.length ?? 0} anuncio(s).`);
    setRecarga((n) => n + 1);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Campañas activas" subtitle="Meta · CPA máximo por campaña" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />
        <div className="flex flex-wrap gap-2 items-center">
          <select className={sel} value={cuenta} onChange={(e) => setCuenta(e.target.value)}>
            {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {pendientes > 0 && (
            <button className="rounded-lg px-3 py-2 text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40"
              disabled={apagando} onClick={apagarAhora}>
              {apagando ? 'Apagando…' : `APAGAR AHORA (${pendientes})`}
            </button>
          )}
        </div>
        <p className="text-xs text-slate-500">
          Gasto con recargo, últimos 7 días con hoy. Con CPA máximo cargado, cada 30 min se apagan los anuncios activos de esa campaña que ya
          llevan 48 h gastando y tienen CPA mayor al máximo, o gastaron más que el máximo sin ventas. Quedan con la etiqueta “Apagado por CPA”.
        </p>
        {cargando && <p className="text-sm text-slate-400">Cargando campañas…</p>}
        {res.error && !cargando && <p className="text-sm text-rose-400">{res.error}</p>}
        {!cargando && !res.error && lista.length === 0 && <p className="text-sm text-slate-500">No hay campañas activas en esta cuenta.</p>}
        <div className="space-y-2">
          {lista.map((c) => <Fila key={`${c.id}|${c.cpaMax}`} c={c} cuenta={cuenta} alGuardar={() => setRecarga((n) => n + 1)} />)}
        </div>
      </main>
    </div>
  );
}
