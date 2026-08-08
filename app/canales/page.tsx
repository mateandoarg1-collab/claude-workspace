'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { EmpretiendaManual, fetchEmpretiendaManual, saveEmpretiendaManual, splitEmpretienda } from '@/lib/manual';

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

function empretiendaMetricasUrl(paymentMethod?: number) {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const from = `${y}-${m}-01_00-00-00L`;
  const until = `${y}-${m}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}L`;
  const params = new URLSearchParams({ from, until });
  if (paymentMethod) params.set('payment_method', String(paymentMethod));
  return `https://panel.empretienda.com/metricas?${params.toString()}`;
}

type Form = { totalMonto: string; totalCant: string; localMonto: string; localCant: string };
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0;

export default function Canales() {
  const [ml, setMl] = useState<{ orders: number; amount: number } | null>(null);
  const [mlErr, setMlErr] = useState('');
  const [mayorista, setMayorista] = useState<{ orders: number; amount: number; tab: string } | null>(null);
  const [mayoristaErr, setMayoristaErr] = useState('');
  const [mp, setMp] = useState<{ orders: number; amount: number } | null>(null);
  const [mpErr, setMpErr] = useState('');
  const [manual, setManual] = useState<EmpretiendaManual | null>(null);
  const [form, setForm] = useState<Form>({ totalMonto: '', totalCant: '', localMonto: '', localCant: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/ml/sales', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMl(d.month_to_date))
      .catch((e) => setMlErr(String(e)));

    fetch('/api/mayorista', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setMayoristaErr(d.error) : setMayorista(d)))
      .catch((e) => setMayoristaErr(String(e)));

    fetch('/api/mercadopago/sales', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setMpErr(d.error) : setMp(d.month_to_date)))
      .catch((e) => setMpErr(String(e)));

    fetchEmpretiendaManual().then((m) => {
      setManual(m);
      setForm({
        totalMonto: String(m.totalMonto || ''),
        totalCant: String(m.totalCant || ''),
        localMonto: String(m.localMonto || ''),
        localCant: String(m.localCant || ''),
      });
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const saved = await saveEmpretiendaManual({
      totalMonto: num(form.totalMonto),
      totalCant: num(form.totalCant),
      localMonto: num(form.localMonto),
      localCant: num(form.localCant),
    });
    setManual(saved);
    setSaving(false);
    setEditing(false);
  }

  const { onlineMonto, onlineCant, localMonto, localCant } = manual ? splitEmpretienda(manual) : { onlineMonto: 0, onlineCant: 0, localMonto: 0, localCant: 0 };
  const formOnlineMonto = Math.max(0, num(form.totalMonto) - num(form.localMonto));
  const formOnlineCant = Math.max(0, num(form.totalCant) - num(form.localCant));

  const mpMonto = mp?.amount ?? 0;
  const mpCant = mp?.orders ?? 0;
  const otrosMonto = Math.max(0, onlineMonto - mpMonto);
  const otrosCant = Math.max(0, onlineCant - mpCant);

  const canales = [
    {
      nombre: 'Tienda Online (.com)', monto: onlineMonto, cantidad: onlineCant, fuente: 'Empretienda − Local',
      sub: [
        { nombre: 'Mercado Pago', monto: mpMonto, cantidad: mpCant, fuente: mpErr ? `Error: ${mpErr}` : 'API en vivo' },
        { nombre: 'Otros medios (Transferencia, GOcuotas, Ualá Bis)', monto: otrosMonto, cantidad: otrosCant, fuente: 'manual, por diferencia' },
      ],
    },
    { nombre: 'Mercado Libre', monto: ml?.amount ?? 0, cantidad: ml?.orders ?? 0, fuente: mlErr ? `Error: ${mlErr}` : 'API en vivo' },
    { nombre: 'Local Físico', monto: localMonto, cantidad: localCant, fuente: 'Empretienda (Acordar) — manual' },
    { nombre: 'Mayorista', monto: mayorista?.amount ?? 0, cantidad: mayorista?.orders ?? 0, fuente: mayoristaErr ? `Error: ${mayoristaErr}` : `Google Sheets (${mayorista?.tab ?? '—'})` },
  ];

  const totalGeneral = canales.reduce((s, c) => s + c.monto, 0);
  const totalVentas = canales.reduce((s, c) => s + c.cantidad, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">🧉 MATEANDO — Ventas por canal</h1>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-slate-600 hover:text-slate-900">Mercado Libre</Link>
            <Link href="/canales" className="font-medium text-emerald-700">Canales</Link>
            <Link href="/resumen" className="text-slate-600 hover:text-slate-900">Resumen 📱</Link>
            <Link href="/preguntas" className="text-slate-600 hover:text-slate-900">Preguntas</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="text-lg font-semibold mb-4">Mes en curso</h2>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Canal</th>
                <th className="text-right">Facturación</th>
                <th className="text-right">Ventas</th>
                <th className="text-right pl-4">Fuente</th>
              </tr>
            </thead>
            <tbody>
              {canales.map((c) => (
                <Fragment key={c.nombre}>
                  <tr className="border-t border-slate-100">
                    <td className="py-3 font-medium">{c.nombre}</td>
                    <td className="text-right tabular-nums">{fmt(c.monto)}</td>
                    <td className="text-right tabular-nums">{c.cantidad}</td>
                    <td className="text-right text-xs text-slate-400 pl-4">{c.fuente}</td>
                  </tr>
                  {c.sub?.map((s) => (
                    <tr key={c.nombre + '-' + s.nombre} className="text-slate-500">
                      <td className="py-1.5 pl-6 text-xs">└ {s.nombre}</td>
                      <td className="text-right tabular-nums text-xs">{fmt(s.monto)}</td>
                      <td className="text-right tabular-nums text-xs">{s.cantidad}</td>
                      <td className="text-right text-xs text-slate-400 pl-4">{s.fuente}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
              <tr className="border-t-2 border-slate-300 font-bold">
                <td className="py-3">Total</td>
                <td className="text-right tabular-nums">{fmt(totalGeneral)}</td>
                <td className="text-right tabular-nums">{totalVentas}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Empretienda (Online + Local) — carga manual</h2>
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {editing ? 'Cerrar' : 'Actualizar números'}
            </button>
          </div>

          {!editing && (
            <p className="text-sm text-slate-500">
              {manual?.updatedAt
                ? `Última carga: ${new Date(manual.updatedAt).toLocaleString('es-AR')} (se ve igual en todos los dispositivos)`
                : 'Todavía no cargaste números. Tocá "Actualizar números".'}
            </p>
          )}

          {editing && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Abrí el panel de Empretienda, sección <strong>Métricas</strong>, y copiá los dos totales del mes:
              </p>
              <div className="flex gap-3 text-sm">
                <a href={empretiendaMetricasUrl()} target="_blank" className="text-emerald-700 underline">
                  Ver Total (todos los métodos)
                </a>
                <a href={empretiendaMetricasUrl(3)} target="_blank" className="text-emerald-700 underline">
                  Ver Local (filtro Acordar)
                </a>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Total Empretienda — Volumen de ventas ($)" value={form.totalMonto}
                  onChange={(v) => setForm({ ...form, totalMonto: v })} />
                <Field label="Total Empretienda — Cantidad de ventas" value={form.totalCant}
                  onChange={(v) => setForm({ ...form, totalCant: v })} />
                <Field label="Local (Acordar) — Volumen de ventas ($)" value={form.localMonto}
                  onChange={(v) => setForm({ ...form, localMonto: v })} />
                <Field label="Local (Acordar) — Cantidad de ventas" value={form.localCant}
                  onChange={(v) => setForm({ ...form, localCant: v })} />
              </div>

              <p className="text-xs text-slate-500">
                Tienda Online se calcula solo: Total − Local = {fmt(formOnlineMonto)} · {formOnlineCant} ventas.
              </p>

              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-500 mb-1">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        placeholder="0"
      />
    </label>
  );
}
