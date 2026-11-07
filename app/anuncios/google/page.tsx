'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../../components/AppHeader';
import Pestanas from '../Pestanas';

// Central de Google Ads (cuenta Mateando 534-660-6046): crear campañas Performance Max / Búsqueda (pausadas)
// con textos de Claude e imágenes de Drive, y prender/pausar/cambiar presupuesto de las existentes.
type Campana = {
  id: string; nombre: string; estado: string; tipo: string; presupuesto: number; budget: string;
  gasto: number; conversiones: number; cpa: number | null; clics: number; ctr: number | null;
};
type Archivo = { id: string; nombre: string; tipo: 'imagen' | 'video'; miniatura?: string };
type Tipo = 'pmax' | 'busqueda';

const $ = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
const sel = 'rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100';
const PERIODOS = [{ v: 'hoy', l: 'Hoy' }, { v: 'ayer', l: 'Ayer' }, { v: '7d', l: '7 días' }, { v: '14d', l: '14 días' }, { v: '30d', l: '30 días' }, { v: 'mes', l: 'Mes' }];
const TIPOS: Array<{ v: Tipo; l: string; ayuda: string }> = [
  { v: 'pmax', l: 'Performance Max', ayuda: 'Productos del catálogo + imágenes en Shopping, YouTube, Display, Búsqueda y Gmail. La que más convierte en e-commerce.' },
  { v: 'busqueda', l: 'Búsqueda', ayuda: 'Anuncios de texto para quien busca en Google (ej. “mate imperial”), con palabras clave.' },
];

function Lista({ titulo, max, valores, onChange }: { titulo: string; max: number; valores: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-1">{titulo} <span className="text-slate-600">(máx. {max} caracteres · uno por línea)</span></p>
      <textarea className={`${sel} w-full h-32 font-mono text-xs`} value={valores.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} />
      {valores.filter((v) => v.trim().length > max).map((v, i) => <p key={i} className="text-[11px] text-rose-400">Largo ({v.trim().length}): {v}</p>)}
    </div>
  );
}

export default function GooglePage() {
  // ── Campañas existentes
  const [periodo, setPeriodo] = useState('7d');
  const [recarga, setRecarga] = useState(0);
  const clave = `${periodo}|${recarga}`;
  const [res, setRes] = useState<{ clave: string; campanas: Campana[]; error: string }>({ clave: '', campanas: [], error: '' });
  const cargando = res.clave !== clave;
  const [ocupado, setOcupado] = useState('');

  useEffect(() => {
    const k = `${periodo}|${recarga}`;
    fetch(`/api/anuncios/google?periodo=${periodo}`).then((r) => r.json())
      .then((j) => setRes({ clave: k, campanas: j.campanas ?? [], error: j.error ?? '' }))
      .catch((e) => setRes({ clave: k, campanas: [], error: String(e) }));
  }, [periodo, recarga]);

  async function cambiar(id: string, body: unknown, pregunta: string) {
    if (!confirm(pregunta)) return;
    setOcupado(id);
    const r = await fetch('/api/anuncios/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado('');
    if (r.error) alert(`Error: ${r.error}`);
    setRecarga((n) => n + 1);
  }

  // ── Nueva campaña
  const [tipo, setTipo] = useState<Tipo>('pmax');
  const [nombre, setNombre] = useState('');
  const [presupuesto, setPresupuesto] = useState(20000);
  const [url, setUrl] = useState('https://www.mateandoarg.com');
  const [idea, setIdea] = useState('');
  const [carpeta, setCarpeta] = useState('');
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [titulos, setTitulos] = useState<string[]>([]);
  const [largos, setLargos] = useState<string[]>([]);
  const [descs, setDescs] = useState<string[]>([]);
  const [palabras, setPalabras] = useState<string[]>([]);
  const [paso, setPaso] = useState('');

  async function leerCarpeta() {
    setPaso('Leyendo carpeta…');
    const j = await fetch(`/api/anuncios/drive?carpeta=${encodeURIComponent(carpeta)}`).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    setPaso('');
    if (j.error) return alert(j.error);
    const imgs = (j.archivos as Archivo[]).filter((a) => a.tipo === 'imagen');
    setArchivos(imgs);
    setElegidas(imgs.slice(0, 6).map((a) => a.id));
    if (!imgs.length) alert('La carpeta no tiene imágenes (Performance Max usa imágenes; los videos van por YouTube).');
  }

  async function generar() {
    setPaso('Generando textos con IA…');
    const j = await fetch('/api/anuncios/google/copys', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idea, tipo }) })
      .then((r) => r.json()).catch((e) => ({ error: String(e) }));
    setPaso('');
    if (j.error) return alert(j.error);
    setTitulos(j.titulos); setLargos(j.titulosLargos); setDescs(j.descripciones); setPalabras(j.palabras);
  }

  async function publicar() {
    const limpio = (l: string[]) => l.map((s) => s.trim()).filter(Boolean);
    const body = { tipo, nombre, presupuesto, url, titulos: limpio(titulos), titulosLargos: limpio(largos), descripciones: limpio(descs), palabras: limpio(palabras), imagenes: elegidas };
    if (!confirm(`Crear en Google Ads la campaña ${TIPOS.find((t) => t.v === tipo)!.l} “${nombre}” con ${$(presupuesto)} por día.\n\nQueda PAUSADA: después se prende acá abajo o en Google Ads.`)) return;
    setPaso(tipo === 'pmax' ? 'Subiendo imágenes y creando campaña…' : 'Creando campaña…');
    const r = await fetch('/api/anuncios/google/crear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setPaso('');
    if (r.error) return alert(`Error: ${r.error}`);
    alert('Listo: campaña creada en pausa.');
    setNombre(''); setTitulos([]); setLargos([]); setDescs([]); setPalabras([]);
    setRecarga((n) => n + 1);
  }

  const hayTextos = titulos.length > 0;
  const listo = nombre.trim() && presupuesto > 0 && hayTextos && (tipo === 'busqueda' ? palabras.some((p) => p.trim()) : elegidas.length > 0);
  const activas = res.campanas.filter((c) => c.estado === 'ENABLED');
  const tot = activas.reduce((s, c) => ({ p: s.p + c.presupuesto, g: s.g + c.gasto, c: s.c + c.conversiones }), { p: 0, g: 0, c: 0 });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Google Ads" subtitle="Central de campañas · cuenta Mateando 534-660-6046" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Pestanas />

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h2 className="font-semibold">Nueva campaña</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TIPOS.map((t) => (
              <button key={t.v} onClick={() => { setTipo(t.v); setTitulos([]); }}
                className={`text-left rounded-xl border p-3 ${tipo === t.v ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}>
                <p className="font-medium text-sm">{t.l}{t.v === 'pmax' && <span className="ml-2 text-[10px] text-emerald-300">RECOMENDADA</span>}</p>
                <p className="text-xs text-slate-400 mt-0.5">{t.ayuda}</p>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className={sel} placeholder="Nombre de la campaña" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <label className="flex items-center gap-2 text-sm text-slate-400">Presupuesto diario $
              <input type="number" className={`${sel} flex-1`} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value) || 0)} />
            </label>
            <input className={sel} placeholder="URL de destino" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>

          {tipo === 'pmax' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input className={`${sel} flex-1`} placeholder="Link de la carpeta de Drive con las imágenes" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} />
                <button className="rounded-lg px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-40" disabled={!carpeta || !!paso} onClick={leerCarpeta}>Leer</button>
              </div>
              {archivos.length > 0 && (
                <>
                  <p className="text-xs text-slate-400">Elegí hasta 6 imágenes ({elegidas.length} elegidas). Cada una se recorta sola a horizontal, cuadrada y vertical. El logo y el nombre “Mateando” ya están en la cuenta. Los productos salen del catálogo de Merchant Center.</p>
                  <div className="flex flex-wrap gap-2">
                    {archivos.map((a) => {
                      const on = elegidas.includes(a.id);
                      return (
                        <button key={a.id} title={a.nombre}
                          onClick={() => setElegidas(on ? elegidas.filter((x) => x !== a.id) : elegidas.length < 6 ? [...elegidas, a.id] : elegidas)}
                          className={`w-20 h-20 rounded-lg overflow-hidden border-2 ${on ? 'border-emerald-400' : 'border-transparent opacity-40'}`}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {a.miniatura && <img src={a.miniatura} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <textarea className={`${sel} w-full h-20`} placeholder="Idea de la campaña (ej. Cyber Monday: 30% off en mates imperiales y envío gratis desde $80.000)"
              value={idea} onChange={(e) => setIdea(e.target.value)} />
            <button className="rounded-lg px-3 py-2 text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-40" disabled={!idea.trim() || !!paso} onClick={generar}>
              {hayTextos ? 'Volver a generar textos' : 'Generar textos con IA'}
            </button>
          </div>

          {hayTextos && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Lista titulo={`Títulos (${titulos.filter((x) => x.trim()).length}/15)`} max={30} valores={titulos} onChange={setTitulos} />
              {tipo === 'pmax'
                ? <Lista titulo={`Títulos largos (${largos.filter((x) => x.trim()).length}/5)`} max={90} valores={largos} onChange={setLargos} />
                : <Lista titulo={`Palabras clave (${palabras.filter((x) => x.trim()).length})`} max={80} valores={palabras} onChange={setPalabras} />}
              <Lista titulo={`Descripciones (${descs.filter((x) => x.trim()).length}/${tipo === 'pmax' ? 5 : 4}) · al menos una de 60 o menos`} max={90} valores={descs} onChange={setDescs} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button className="rounded-lg px-4 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40" disabled={!listo || !!paso} onClick={publicar}>
              Publicar en Google Ads (queda pausada)
            </button>
            {paso && <span className="text-sm text-slate-400">{paso}</span>}
          </div>
          <p className="text-xs text-slate-500">Puja: Maximizar conversiones (compra de la tienda). Ubicación: Argentina. Idioma: español.</p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold mr-auto">Campañas</h2>
            <select className={sel} value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
              {PERIODOS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </div>
          {!cargando && !res.error && (
            <p className="text-xs text-slate-400">
              Activas: {activas.length} · presupuesto {$(tot.p)}/día · gasto {$(tot.g)} · {Math.round(tot.c)} conversiones{tot.c ? ` · CPA ${$(tot.g / tot.c)}` : ''}
            </p>
          )}
          {cargando && <p className="text-sm text-slate-400">Cargando campañas…</p>}
          {res.error && !cargando && <p className="text-sm text-rose-400">{res.error}</p>}
          <div className="space-y-2">
            {!cargando && res.campanas.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {c.estado === 'ENABLED' ? <span className="text-emerald-400">● Activa</span> : <span>○ Pausada</span>} · {c.tipo} · {$(c.presupuesto)}/día
                  </p>
                </div>
                <div className="grid grid-cols-4 gap-3 text-right text-xs tabular-nums">
                  <div><p className="text-[10px] text-slate-500">GASTO</p>{$(c.gasto)}</div>
                  <div><p className="text-[10px] text-slate-500">CONV.</p>{Math.round(c.conversiones * 10) / 10}</div>
                  <div><p className="text-[10px] text-slate-500">CPA</p>{c.cpa === null ? '—' : $(c.cpa)}</div>
                  <div><p className="text-[10px] text-slate-500">CTR</p>{c.ctr === null ? '—' : `${c.ctr.toFixed(1)}%`}</div>
                </div>
                <div className="flex gap-1">
                  <button className="rounded-lg px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-40" disabled={ocupado === c.id || !c.budget}
                    onClick={() => {
                      const v = Number(prompt(`Nuevo presupuesto diario para “${c.nombre}” (hoy ${$(c.presupuesto)}):`, String(c.presupuesto)));
                      if (v > 0 && v !== c.presupuesto) cambiar(c.id, { budget: c.budget, presupuesto: v }, `¿Cambiar el presupuesto de ${$(c.presupuesto)} a ${$(v)} por día?`);
                    }}>Presupuesto</button>
                  <button className={`rounded-lg px-2 py-1 text-xs font-semibold disabled:opacity-40 ${c.estado === 'ENABLED' ? 'text-amber-300 hover:bg-amber-500/10' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                    disabled={ocupado === c.id}
                    onClick={() => cambiar(c.id, { id: c.id, estado: c.estado === 'ENABLED' ? 'PAUSED' : 'ENABLED' },
                      c.estado === 'ENABLED' ? `¿Pausar “${c.nombre}”?` : `¿Prender “${c.nombre}”? Empieza a gastar hasta ${$(c.presupuesto)} por día.`)}>
                    {ocupado === c.id ? '…' : c.estado === 'ENABLED' ? 'Pausar' : 'Prender'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
