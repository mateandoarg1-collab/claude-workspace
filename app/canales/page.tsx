'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { EmpretiendaManual, fetchEmpretiendaManual, saveEmpretiendaManual } from '@/lib/manual';

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

type Form = { gocuotasMonto: string; gocuotasCant: string };
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0;

export default function Canales() {
  const [ml, setMl] = useState<{ orders: number; amount: number } | null>(null);
  const [mlErr, setMlErr] = useState('');
  const [mayorista, setMayorista] = useState<{ orders: number; amount: number; tab: string } | null>(null);
  const [mayoristaErr, setMayoristaErr] = useState('');
  const [mp, setMp] = useState<{ orders: number; amount: number } | null>(null);
  const [mpErr, setMpErr] = useState('');
  const [comprobantes, setComprobantes] = useState<{ orders: number; amount: number } | null>(null);
  const [comprobantesErr, setComprobantesErr] = useState('');
  const [local, setLocal] = useState<{ orders: number; amount: number } | null>(null);
  const [localErr, setLocalErr] = useState('');
  const [manual, setManual] = useState<EmpretiendaManual | null>(null);
  const [form, setForm] = useState<Form>({ gocuotasMonto: '', gocuotasCant: '' });
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

    fetch('/api/comprobantes', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setComprobantesErr(d.error) : setComprobantes(d)))
      .catch((e) => setComprobantesErr(String(e)));

    fetch('/api/local', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.error ? setLocalErr(d.error) : setLocal(d)))
      .catch((e) => setLocalErr(String(e)));

    fetchEmpretiendaManual().then((m) => {
      setManual(m);
      setForm({
        gocuotasMonto: String(m.gocuotasMonto || ''),
        gocuotasCant: String(m.gocuotasCant || ''),
      });
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    const saved = await saveEmpretiendaManual({
      gocuotasMonto: num(form.gocuotasMonto),
      gocuotasCant: num(form.gocuotasCant),
    });
    setManual(saved);
    setSaving(false);
    setEditing(false);
  }

  const mpMonto = mp?.amount ?? 0;
  const mpCant = mp?.orders ?? 0;
  const compMonto = comprobantes?.amount ?? 0;
  const compCant = comprobantes?.orders ?? 0;
  const gocuotasMonto = manual?.gocuotasMonto ?? 0;
  const gocuotasCant = manual?.gocuotasCant ?? 0;

  const onlineMonto = mpMonto + compMonto + gocuotasMonto;
  const onlineCant = mpCant + compCant + gocuotasCant;

  const canales = [
    {
      nombre: 'Tienda Online (.com)', monto: onlineMonto, cantidad: onlineCant, fuente: 'MP + Transferencias + GOcuotas',
      sub: [
        { nombre: 'Mercado Pago', monto: mpMonto, cantidad: mpCant, fuente: mpErr ? `Error: ${mpErr}` : 'API en vivo' },
        { nombre: 'Transferencias (comprobantes)', monto: compMonto, cantidad: compCant, fuente: comprobantesErr ? `Error: ${comprobantesErr}` : 'Google Sheets en vivo' },
        { nombre: 'GOcuotas', monto: gocuotasMonto, cantidad: gocuotasCant, fuente: 'manual' },
      ],
    },
    { nombre: 'Mercado Libre', monto: ml?.amount ?? 0, cantidad: ml?.orders ?? 0, fuente: mlErr ? `Error: ${mlErr}` : 'API en vivo' },
    { nombre: 'Local Físico', monto: local?.amount ?? 0, cantidad: local?.orders ?? 0, fuente: localErr ? `Error: ${localErr}` : 'Cargado en /caja — en vivo' },
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
          <p className="text-xs text-slate-400 mt-3">
            Local Físico ahora se carga desde <a href="/caja" target="_blank" className="text-emerald-700 underline">/caja</a> — el equipo del local registra cada venta ahí y suma solo.
          </p>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">GOcuotas — carga manual</h2>
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
                Mercado Pago, Transferencias y Local ya se calculan solos. Solo falta GOcuotas: abrí el panel de
                Empretienda, sección <strong>Métricas</strong>, filtrá por método de pago GOcuotas y copiá los totales.
              </p>
              <a href={empretiendaMetricasUrl()} target="_blank" className="text-emerald-700 underline text-sm">
                Abrir Métricas
              </a>

              <div className="grid grid-cols-2 gap-4">
                <Field label="GOcuotas — Volumen de ventas ($)" value={form.gocuotasMonto}
                  onChange={(v) => setForm({ ...form, gocuotasMonto: v })} />
                <Field label="GOcuotas — Cantidad de ventas" value={form.gocuotasCant}
                  onChange={(v) => setForm({ ...form, gocuotasCant: v })} />
              </div>

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
