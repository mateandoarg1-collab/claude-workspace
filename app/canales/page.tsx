'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';
import CanalMarca, { type CanalId } from '../components/CanalMarca';
import CanalDailyChart from '../components/CanalDailyChart';
import { EmpretiendaManual, fetchEmpretiendaManual } from '@/lib/manual';
import { desdeAR, type Periodo } from '@/lib/periodo';

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

const PERIODOS: { id: Periodo; label: string; titulo: string }[] = [
  { id: 'hoy', label: 'Hoy', titulo: 'Hoy' },
  { id: 'ayer', label: 'Ayer', titulo: 'Ayer' },
  { id: 'semana', label: 'Semana', titulo: 'Últimos 7 días' },
  { id: 'mes', label: 'Mes', titulo: 'Mes en curso' },
];

type Venta = { orders: number; amount: number };

// "hace 12 min", "hace 2 h"…
function hace(iso: string, ahora: number) {
  const min = Math.max(0, Math.round((ahora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}
type Estado<T> = { data: T | null; err: string };
const VACIO = { data: null, err: '' };

function useApi<T>(url: string): Estado<T> {
  const [s, setS] = useState<Estado<T> & { url: string }>({ ...VACIO, url: '' });
  useEffect(() => {
    let vivo = true;
    fetch(url, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => vivo && setS(d.error ? { data: null, err: d.error, url } : { data: d, err: '', url }))
      .catch((e) => vivo && setS({ data: null, err: String(e), url }));
    return () => { vivo = false; };
  }, [url]);
  return s.url === url ? s : VACIO; // mientras carga el período nuevo, no mostrar el anterior
}

export default function Canales() {
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [grafico, setGrafico] = useState<CanalId | null>(null);
  const ml = useApi<Venta & { ads: number | null }>(`/api/ml/periodo?periodo=${periodo}`);
  const shopify = useApi<Venta>(`/api/shopify?periodo=${periodo}`);
  const meta = useApi<{ spend: number | null; motivo?: string }>(`/api/meta?periodo=${periodo}`);
  const metaMay = useApi<{ spend: number | null; motivo?: string }>(`/api/meta?cuenta=mayorista&periodo=${periodo}`);
  const gads = useApi<{ spend: number | null; motivo?: string }>(`/api/google-ads?periodo=${periodo}`);
  const tiktok = useApi<{ spend: number | null; motivo?: string }>(`/api/tiktok?periodo=${periodo}`);
  const mayorista = useApi<Venta & { tab: string }>(`/api/mayorista?periodo=${periodo}`);
  const [manual, setManual] = useState<EmpretiendaManual | null>(null);

  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    fetchEmpretiendaManual().then(setManual);
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Empretienda (lo sube mateandobot): Acordar = Local, el resto = Online. Solo si es del período actual.
  const emp = manual?.metricas?.find((m) => m.periodo === periodo && m.desde === desdeAR(periodo)) ?? null;
  const empFuente = emp
    ? `Empretienda Métricas · ${new Date(emp.updatedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : manual ? 'Sin datos de mateandobot para este período' : '';

  const fuente = (s: Estado<unknown>, ok: string) => (s.err ? `Error: ${s.err}` : s.data ? ok : 'Cargando…');
  const canales = [
    { id: 'online' as CanalId, nombre: 'Tienda Online (.com)', monto: emp ? emp.totalMonto - emp.acordarMonto : 0, cantidad: emp ? emp.totalCant - emp.acordarCant : 0, fuente: emp ? `${empFuente} (total − Acordar)` : empFuente, hace: emp ? hace(emp.updatedAt, ahora) : '' },
    { id: 'ml' as CanalId, nombre: 'Mercado Libre', monto: ml.data?.amount ?? 0, cantidad: ml.data?.orders ?? 0, fuente: fuente(ml, 'API en vivo') },
    { id: 'local' as CanalId, nombre: 'Local Físico', monto: emp?.acordarMonto ?? 0, cantidad: emp?.acordarCant ?? 0, fuente: emp ? `${empFuente} (Acordar)` : empFuente, hace: emp ? hace(emp.updatedAt, ahora) : '' },
    { id: 'shopify' as CanalId, nombre: 'Shopify (mateando.com)', monto: shopify.data?.amount ?? 0, cantidad: shopify.data?.orders ?? 0, fuente: fuente(shopify, 'API en vivo · pedidos pagados (subtotal con IVA)') },
    { id: 'mayorista' as CanalId, nombre: 'Mayorista', monto: mayorista.data?.amount ?? 0, cantidad: mayorista.data?.orders ?? 0, fuente: fuente(mayorista, `Google Sheets (${mayorista.data?.tab ?? '—'})`) },
  ];

  // ROAS: ML con su pauta propia (Product Ads); Meta (2 cuentas), Google Ads y TikTok son la pauta de la Tienda Online.
  const monto = (id: CanalId) => canales.find((c) => c.id === id)?.monto ?? 0;
  const roas = [
    { nombre: 'Mercado Libre', canal: 'ml' as CanalId, detalle: 'Product Ads (API ML)', ventas: monto('ml'), pauta: ml.data ? ml.data.ads : undefined, falta: 'No se pudo leer la publicidad de ML' },
    { nombre: 'Meta Mayorista', canal: 'mayorista' as CanalId, detalle: 'Mayorista · cuenta MATEANDO-MANYCHAT (mensajes, +8% comisión)', ventas: monto('mayorista'), pauta: metaMay.data ? metaMay.data.spend : undefined, falta: metaMay.data?.motivo ?? '' },
    { nombre: 'Meta Ads', canal: 'online' as CanalId, detalle: 'Tienda Online (Empretienda) · 2 cuentas (MATEANDO2 +8% comisión)', ventas: monto('online'), pauta: meta.data ? meta.data.spend : undefined, falta: meta.data?.motivo ?? '' },
    { nombre: 'Google Ads', canal: 'online' as CanalId, detalle: 'Tienda Online (Empretienda) · cuenta 534-660-6046', ventas: monto('online'), pauta: gads.data ? gads.data.spend : undefined, falta: gads.data?.motivo ?? '' },
    { nombre: 'TikTok Ads', canal: 'online' as CanalId, detalle: 'Tienda Online (Empretienda) · ANDOMAT 611 SRL', ventas: monto('online'), pauta: tiktok.data ? tiktok.data.spend : undefined, falta: tiktok.data?.motivo ?? '' },
  ];
  const pautaTotal = roas.reduce((s, r) => s + (r.pauta ?? 0), 0);
  // ventas de cada canal una sola vez (Meta y Google empujan las mismas ventas de la Tienda Online)
  const ventasConPauta = [...new Set(roas.filter((r) => r.pauta != null).map((r) => r.canal))].reduce((s, c) => s + monto(c), 0);
  // Tienda Online junta: Meta + Google + TikTok contra las mismas ventas
  const pautaOnline = roas.filter((r) => r.canal === 'online' && r.pauta != null).reduce((s, r) => s + (r.pauta ?? 0), 0);
  const fmtRoas = (v: number, p: number | null | undefined) => (p ? `${(v / p).toFixed(1)}x` : '—');

  const totalGeneral = canales.reduce((s, c) => s + c.monto, 0);
  const totalVentas = canales.reduce((s, c) => s + c.cantidad, 0);
  const cargando = !manual || !ml.data || !shopify.data || !mayorista.data;

  return (
    <div className="min-h-screen bg-slate-950">
      <AppHeader title="Ventas por canal" width="5xl" />

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-lg font-semibold">{PERIODOS.find((p) => p.id === periodo)?.titulo}</h2>
            <div className="inline-flex rounded-lg border border-slate-800 p-0.5 bg-slate-950">
              {PERIODOS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPeriodo(p.id)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${periodo === p.id ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <table className={`w-full text-sm ${cargando ? 'opacity-60' : ''}`}>
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2">Canal</th>
                <th className="text-right"><span className="sm:hidden">$</span><span className="hidden sm:inline">Facturación</span></th>
                <th className="text-right pl-4">Ventas</th>
                <th className="hidden sm:table-cell text-right pl-4">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {canales.map((c) => (
                <tr key={c.nombre} onClick={() => setGrafico((g) => (g === c.id ? null : c.id))}
                  className={`border-t border-slate-900 cursor-pointer hover:bg-slate-800/40 ${grafico === c.id ? 'bg-slate-800/60' : ''}`}>
                  <td className="py-3 font-medium">
                    <span className="inline-flex items-center gap-2 flex-wrap" title={c.nombre}>
                      <CanalMarca id={c.id} />
                      <span className={`text-xs ${grafico === c.id ? 'opacity-100' : 'opacity-50'}`}>📊</span>
                      {'hace' in c && c.hace && <span className="text-[11px] font-normal text-slate-500">({c.hace === 'recién' ? 'actualizado recién' : `actualizado ${c.hace}`})</span>}
                    </span>
                    {c.fuente.startsWith('Error') && <div className="sm:hidden text-xs font-normal text-red-400">{c.fuente}</div>}
                  </td>
                  <td className="text-right tabular-nums">{fmt(c.monto)}</td>
                  <td className="text-right tabular-nums pl-4">{c.cantidad}</td>
                  <td className="hidden sm:table-cell text-right text-xs text-slate-500 pl-4">{c.fuente}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-700 font-bold">
                <td className="py-3">Total</td>
                <td className="text-right tabular-nums">{fmt(totalGeneral)}</td>
                <td className="text-right tabular-nums pl-4">{totalVentas}</td>
                <td className="hidden sm:table-cell"></td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">
            Tienda Online y Local Físico salen de Métricas de Empretienda (Local = Acordar); se actualizan solas cada 30 min (GitHub Actions, no hace falta la Mac).
            Semana = últimos 7 días contando hoy.
          </p>
          <p className="text-xs text-slate-500 mt-1">Tocá un canal para ver su gráfico por día.</p>
        </section>

        {grafico && <CanalDailyChart canal={grafico} onClose={() => setGrafico(null)} />}

        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4 sm:p-6">
          <h2 className="text-lg font-semibold mb-4">Pauta y ROAS</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-400">
              <tr>
                <th className="py-2">Pauta</th>
                <th className="text-right">Ventas</th>
                <th className="text-right pl-4">Gasto</th>
                <th className="text-right pl-4">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {roas.map((r) => (
                <tr key={r.nombre} className="border-t border-slate-900">
                  <td className="py-3 font-medium">
                    {r.nombre}
                    <div className="text-xs font-normal text-slate-500">{r.pauta === null ? <span className="text-amber-400">{r.falta}</span> : r.detalle}</div>
                  </td>
                  <td className="text-right tabular-nums">{fmt(r.ventas)}</td>
                  <td className="text-right tabular-nums pl-4">{r.pauta === undefined ? '…' : r.pauta === null ? '—' : fmt(r.pauta)}</td>
                  <td className="text-right tabular-nums pl-4 font-bold text-emerald-300">{fmtRoas(r.ventas, r.pauta)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-800 bg-slate-950/40 font-semibold">
                <td className="py-3 pl-2">
                  Tienda Online
                  <div className="text-xs font-normal text-slate-500">Meta + Google + TikTok juntos</div>
                </td>
                <td className="text-right tabular-nums">{fmt(monto('online'))}</td>
                <td className="text-right tabular-nums pl-4">{fmt(pautaOnline)}</td>
                <td className="text-right tabular-nums pl-4 text-emerald-300">{fmtRoas(monto('online'), pautaOnline)}</td>
              </tr>
              <tr className="border-t-2 border-slate-700 font-bold">
                <td className="py-3">Total con pauta</td>
                <td className="text-right tabular-nums">{fmt(ventasConPauta)}</td>
                <td className="text-right tabular-nums pl-4">{fmt(pautaTotal)}</td>
                <td className="text-right tabular-nums pl-4 text-emerald-300">{fmtRoas(ventasConPauta, pautaTotal)}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-slate-500 mt-3">
            ROAS = ventas ÷ gasto en pauta del mismo período. Meta, Google y TikTok se miden contra las mismas ventas de la Tienda Online (en el total cuentan una vez). Meta Mayorista se mide contra las ventas Mayorista. Local y Shopify no entran.
          </p>
        </section>
      </main>
    </div>
  );
}

