'use client';

import { useState } from 'react';

export default function Caja() {
  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<'efectivo' | 'transferencia'>('efectivo');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  async function registrar() {
    const n = Number(monto.replace(/\./g, '').replace(',', '.'));
    if (!n || n <= 0) return;
    setSaving(true);
    setStatus('idle');
    try {
      const r = await fetch('/api/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monto: n, metodo }),
      });
      if (!r.ok) throw new Error();
      setStatus('ok');
      setMonto('');
      setMetodo('efectivo');
    } catch {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-6">
        <h1 className="text-xl font-bold text-center">🧉 Registrar venta — Local</h1>

        <label className="block">
          <span className="block text-sm text-slate-500 mb-2">Monto ($)</span>
          <input
            type="text"
            inputMode="decimal"
            value={monto}
            onChange={(e) => { setMonto(e.target.value); setStatus('idle'); }}
            placeholder="0"
            autoFocus
            className="w-full border border-slate-300 rounded-xl px-4 py-4 text-3xl text-center font-bold"
          />
        </label>

        <div>
          <span className="block text-sm text-slate-500 mb-2">Método de pago</span>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMetodo('efectivo')}
              className={`py-3 rounded-xl font-medium border-2 ${metodo === 'efectivo' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
            >
              Efectivo
            </button>
            <button
              onClick={() => setMetodo('transferencia')}
              className={`py-3 rounded-xl font-medium border-2 ${metodo === 'transferencia' ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}
            >
              Transferencia
            </button>
          </div>
        </div>

        <button
          onClick={registrar}
          disabled={saving || !monto}
          className="w-full py-4 rounded-xl bg-emerald-600 text-white text-lg font-bold disabled:opacity-40"
        >
          {saving ? 'Registrando…' : 'Registrar venta'}
        </button>

        {status === 'ok' && (
          <p className="text-center text-emerald-600 font-medium">✓ Venta registrada</p>
        )}
        {status === 'error' && (
          <p className="text-center text-red-600 font-medium">Error al registrar, probá de nuevo</p>
        )}
      </div>
    </div>
  );
}
