'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Q = {
  id: number;
  text: string;
  date_created: string;
  item_id: string;
  item_title: string;
  item_price: number;
  item_permalink: string;
};

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

export default function Preguntas() {
  const [data, setData] = useState<{ total: number; questions: Q[] } | null>(null);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<number | null>(null);

  async function load() {
    setErr('');
    try {
      const r = await fetch('/api/ml/questions', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  async function send(id: number) {
    const text = answers[id]?.trim();
    if (!text) return;
    setSending(id);
    const r = await fetch('/api/ml/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_id: id, text }),
    });
    setSending(null);
    if (r.ok) {
      setAnswers((s) => ({ ...s, [id]: '' }));
      load();
    } else {
      const j = await r.json();
      alert('Error: ' + (j.error || r.status));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🧉 MATEANDO — Preguntas pendientes</h1>
            <p className="text-xs text-slate-500">
              {data ? `${data.total} sin responder` : 'Cargando…'}
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-slate-600 hover:text-slate-900">Ventas</Link>
            <Link href="/preguntas" className="font-medium text-emerald-700">Preguntas</Link>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); location.href = '/login'; }}
              className="text-slate-500 hover:text-red-600"
            >Salir</button>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        {err && <div className="bg-red-50 text-red-700 p-3 rounded">{err}</div>}
        {!data && <div className="text-slate-500">Cargando preguntas…</div>}
        {data && data.questions.length === 0 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center text-slate-500">
            ✅ Sin preguntas pendientes
          </div>
        )}
        {data?.questions.map((q) => (
          <div key={q.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 space-y-3">
            <div className="flex justify-between items-start gap-3">
              <div className="flex-1 min-w-0">
                <a href={q.item_permalink} target="_blank" rel="noreferrer"
                   className="text-sm text-emerald-700 hover:underline truncate block">
                  {q.item_title}
                </a>
                <div className="text-xs text-slate-500 mt-0.5">
                  {fmt(q.item_price)} · {new Date(q.date_created).toLocaleString('es-AR')}
                </div>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm">
              {q.text}
            </div>
            <div className="flex gap-2">
              <textarea
                value={answers[q.id] || ''}
                onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
                placeholder="Escribí tu respuesta…"
                rows={2}
                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button
                onClick={() => send(q.id)}
                disabled={sending === q.id || !answers[q.id]?.trim()}
                className="bg-emerald-600 text-white px-4 rounded-lg font-medium text-sm hover:bg-emerald-700 disabled:opacity-40"
              >
                {sending === q.id ? '…' : 'Responder'}
              </button>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
