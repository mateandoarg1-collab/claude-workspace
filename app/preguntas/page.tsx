'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import PreguntasBadge from '../components/PreguntasBadge';

type GroupedQuestion = {
  id: number;
  text: string;
  date_created: string;
  answer: { text: string; date_created: string } | null;
};
type Group = {
  item_id: string;
  item_title: string;
  item_price: number;
  item_permalink: string;
  item_thumbnail: string | null;
  item_stock: number;
  questions: GroupedQuestion[];
};
type Data = { total: number; has_more: boolean; next_offset: number; groups: Group[] };

const fmt = (n: number) => '$' + n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const h = diffMs / 3.6e6;
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 24) return `hace ${Math.round(h)} horas`;
  return `hace ${Math.round(h / 24)} días`;
};

function mergeGroups(base: Group[], extra: Group[]): Group[] {
  const map = new Map(base.map((g) => [g.item_id, { ...g, questions: [...g.questions] }]));
  extra.forEach((g) => {
    const existing = map.get(g.item_id);
    if (existing) existing.questions.push(...g.questions);
    else map.set(g.item_id, g);
  });
  return Array.from(map.values());
}

export default function Preguntas() {
  const [tab, setTab] = useState<'pendientes' | 'respondidas'>('pendientes');
  const [pendingCount, setPendingCount] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<number | null>(null);

  async function loadPendingCount() {
    try {
      const r = await fetch('/api/ml/questions/pending-count', { cache: 'no-store' });
      if (r.ok) setPendingCount((await r.json()).count ?? 0);
    } catch {
      /* silencioso */
    }
  }

  async function load(status: 'pendientes' | 'respondidas', offset = 0) {
    setErr('');
    if (offset === 0) setData(null);
    else setLoadingMore(true);
    try {
      const apiStatus = status === 'pendientes' ? 'unanswered' : 'answered';
      const r = await fetch(`/api/ml/questions?status=${apiStatus}&offset=${offset}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j: Data = await r.json();
      setData((prev) => (offset === 0 || !prev ? j : { ...j, groups: mergeGroups(prev.groups, j.groups) }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(tab);
    loadPendingCount();
    const id = setInterval(() => {
      load(tab);
      loadPendingCount();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
      load('pendientes');
      loadPendingCount();
    } else {
      const j = await r.json();
      alert('Error: ' + (j.error || r.status));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">🧉 MATEANDO — Preguntas</h1>
            <p className="text-xs text-slate-500">
              {pendingCount > 0 ? `${pendingCount} sin responder — ¡el tiempo de respuesta importa!` : 'Todo al día ✅'}
            </p>
          </div>
          <nav className="flex gap-3 text-sm">
            <Link href="/" className="text-slate-600 hover:text-slate-900">Ventas</Link>
            <Link href="/productos" className="text-slate-600 hover:text-slate-900">Productos</Link>
            <Link href="/preguntas" className="font-medium text-emerald-700 flex items-center">Preguntas<PreguntasBadge /></Link>
            <button
              onClick={async () => { await fetch('/api/auth', { method: 'DELETE' }); location.href = '/login'; }}
              className="text-slate-500 hover:text-red-600"
            >Salir</button>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <div className="flex gap-2">
          <button
            onClick={() => setTab('pendientes')}
            className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-2 transition-colors ${
              tab === 'pendientes'
                ? 'bg-red-600 text-white'
                : pendingCount > 0
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            Pendientes
            {pendingCount > 0 && (
              <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded-full text-xs font-bold ${
                tab === 'pendientes' ? 'bg-white text-red-600' : 'bg-red-600 text-white'
              }`}>
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('respondidas')}
            className={`px-4 py-2 rounded-full text-sm font-semibold transition-colors ${
              tab === 'respondidas' ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            Respondidas
          </button>
        </div>

        {err && <div className="bg-red-50 text-red-700 p-3 rounded">{err}</div>}
        {!data && !err && <div className="text-slate-500">Cargando preguntas…</div>}
        {data && data.groups.length === 0 && (
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center text-slate-500">
            {tab === 'pendientes' ? '✅ Sin preguntas pendientes' : 'Todavía no hay preguntas respondidas'}
          </div>
        )}

        {data?.groups.map((g) => (
          <div key={g.item_id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <a
              href={g.item_permalink}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-4 border-b border-slate-100 hover:bg-slate-50"
            >
              {g.item_thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={g.item_thumbnail} alt="" className="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-slate-100 border border-slate-200" />
              ) : (
                <div className="w-14 h-14 rounded-lg flex-shrink-0 bg-slate-100 border border-slate-200 flex items-center justify-center">🧉</div>
              )}
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate">{g.item_title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{fmt(g.item_price)} · stock {g.item_stock}</div>
              </div>
            </a>

            <div className="divide-y divide-slate-100">
              {g.questions.map((q) => (
                <div key={q.id} className="p-4 space-y-2">
                  <div className="text-sm">{q.text}</div>
                  <div className="text-xs text-slate-400">{timeAgo(q.date_created)}</div>

                  {q.answer ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-900">
                      {q.answer.text}
                    </div>
                  ) : (
                    <div className="flex gap-2 pt-1">
                      <textarea
                        value={answers[q.id] || ''}
                        onChange={(e) => setAnswers((s) => ({ ...s, [q.id]: e.target.value }))}
                        placeholder="Escribí tu respuesta…"
                        rows={2}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <button
                        onClick={() => send(q.id)}
                        disabled={sending === q.id || !answers[q.id]?.trim()}
                        className="bg-red-600 text-white px-4 rounded-lg font-medium text-sm hover:bg-red-700 disabled:opacity-40"
                      >
                        {sending === q.id ? '…' : 'Responder'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {data?.has_more && (
          <div className="text-center pt-2">
            <button
              onClick={() => load(tab, data.next_offset)}
              disabled={loadingMore}
              className="px-5 py-2 rounded-full border border-slate-300 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-50"
            >
              {loadingMore ? 'Cargando…' : 'Ver más'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
