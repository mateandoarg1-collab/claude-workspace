'use client';

import { useEffect, useState } from 'react';
import AppHeader from '../components/AppHeader';

// Carga de anuncios en Meta (para Agus Machado): carpeta de Drive → campaña CBO → conjuntos → anuncios.
// Regla: cada conjunto es 100% imágenes o 100% videos. Todo se crea PAUSADO.

type Archivo = { id: string; nombre: string; tipo: 'imagen' | 'video'; miniatura?: string; mb: number | null };
type Cuenta = { id: string; nombre: string; moneda: string; pixeles: Array<{ id: string; nombre: string }> };
type Ad = { archivo: string; texto: string; titulo: string };
type Conjunto = { nombre: string; tipo: 'imagen' | 'video'; ads: Ad[] };

const CTAS = ['SHOP_NOW', 'LEARN_MORE', 'BUY_NOW', 'ORDER_NOW', 'SEND_MESSAGE', 'WHATSAPP_MESSAGE'];
const input = 'w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-500';
const card = 'rounded-xl border border-slate-800 bg-slate-900 p-4 sm:p-5';
const btn = 'rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40';

const nuevoConjunto = (i: number, tipo: 'imagen' | 'video' = 'imagen'): Conjunto => ({
  nombre: `Conjunto ${i}`, tipo, ads: [0, 1, 2].map(() => ({ archivo: '', texto: '', titulo: '' })),
});

// Arma solo los conjuntos: de a 3 imágenes y de a 3 videos, sin mezclar.
// Lo que sobra (1 o 2 archivos de un tipo) queda afuera y se avisa.
const POR_CONJUNTO = 3;
function armarConjuntos(archivos: Archivo[]): Conjunto[] {
  const out: Conjunto[] = [];
  for (const tipo of ['imagen', 'video'] as const) {
    const pool = archivos.filter((a) => a.tipo === tipo);
    for (let i = 0; i + POR_CONJUNTO <= pool.length; i += POR_CONJUNTO) {
      out.push({
        nombre: `Conjunto ${out.length + 1} - ${tipo === 'imagen' ? 'Imágenes' : 'Videos'}`,
        tipo,
        ads: pool.slice(i, i + POR_CONJUNTO).map((a) => ({ archivo: a.id, texto: '', titulo: '' })),
      });
    }
  }
  return out.length ? out : [nuevoConjunto(1)];
}

async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

export default function AnunciosPage() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [errCuentas, setErrCuentas] = useState('');
  const [cuenta, setCuenta] = useState('');
  const [pixel, setPixel] = useState('');
  const [carpeta, setCarpeta] = useState('');
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [cargandoDrive, setCargandoDrive] = useState(false);
  const [errDrive, setErrDrive] = useState('');
  const [campana, setCampana] = useState('');
  const [presupuesto, setPresupuesto] = useState(20000);
  const [link, setLink] = useState('https://www.mateandoarg.com');
  const [cta, setCta] = useState('SHOP_NOW');
  const [pagina, setPagina] = useState('432778647449503');
  const [instagram, setInstagram] = useState('17841416378822536');
  const [idea, setIdea] = useState('');
  const [generando, setGenerando] = useState(false);
  const [conjuntos, setConjuntos] = useState<Conjunto[]>([nuevoConjunto(1)]);
  const [log, setLog] = useState<string[]>([]);
  const [creando, setCreando] = useState(false);

  useEffect(() => {
    fetch('/api/anuncios/cuentas').then((r) => r.json()).then((j) => {
      setCuentas(j.cuentas ?? []);
      setErrCuentas(j.motivo || (j.errores ?? []).join(' · '));
      if (j.cuentas?.[0]) { setCuenta(j.cuentas[0].id); setPixel(j.cuentas[0].pixeles?.[0]?.id ?? ''); }
    }).catch((e) => setErrCuentas(String(e)));
  }, []);
  const cuentaSel = cuentas.find((c) => c.id === cuenta);

  async function leerCarpeta() {
    setCargandoDrive(true); setErrDrive('');
    try {
      const r = await fetch(`/api/anuncios/drive?carpeta=${encodeURIComponent(carpeta)}`);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      setArchivos(j.archivos);
      setConjuntos(armarConjuntos(j.archivos));
      if (!campana) setCampana(`CBO ${new Date().toLocaleDateString('es-AR')}`);
    } catch (e) { setErrDrive(e instanceof Error ? e.message : String(e)); }
    setCargandoDrive(false);
  }

  const upd = (ci: number, f: (c: Conjunto) => Conjunto) => setConjuntos((cs) => cs.map((c, i) => (i === ci ? f(c) : c)));
  const updAd = (ci: number, ai: number, patch: Partial<Ad>) =>
    upd(ci, (c) => ({ ...c, ads: c.ads.map((a, i) => (i === ai ? { ...a, ...patch } : a)) }));

  // Reparte automáticamente los archivos del tipo de cada conjunto, sin repetir.
  function autoAsignar() {
    const usados = new Set<string>();
    setConjuntos((cs) => cs.map((c) => {
      const pool = archivos.filter((a) => a.tipo === c.tipo);
      return {
        ...c, ads: c.ads.map((ad) => {
          const libre = pool.find((a) => !usados.has(a.id)) ?? pool[0];
          if (libre) usados.add(libre.id);
          return { ...ad, archivo: libre?.id ?? '' };
        }),
      };
    }));
  }

  async function generarCopys() {
    const total = conjuntos.reduce((s, c) => s + c.ads.length, 0);
    setGenerando(true);
    try {
      const { copys } = await post('/api/anuncios/copys', { idea, cantidad: total });
      let k = 0;
      setConjuntos((cs) => cs.map((c) => ({
        ...c, ads: c.ads.map((a) => { const cp = copys[k++ % copys.length]; return { ...a, texto: cp.texto, titulo: cp.titulo }; }),
      })));
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    setGenerando(false);
  }

  const problemas: string[] = [];
  if (!cuenta) problemas.push('Elegí la cuenta publicitaria');
  if (!campana.trim()) problemas.push('Poné nombre a la campaña');
  if (!(presupuesto > 0)) problemas.push('Poné el presupuesto diario');
  conjuntos.forEach((c, ci) => c.ads.forEach((a, ai) => {
    const arch = archivos.find((x) => x.id === a.archivo);
    if (!arch) problemas.push(`${c.nombre} · anuncio ${ai + 1}: falta archivo`);
    else if (arch.tipo !== c.tipo) problemas.push(`${c.nombre}: no se mezclan imágenes y videos`);
    if (!a.texto.trim() && !idea.trim()) problemas.push('Escribí la idea del copy (paso 3)');
    void ci;
  }));

  async function crear() {
    if (!confirm(`Se va a crear "${campana}" (CBO $${presupuesto.toLocaleString('es-AR')}/día) con ${conjuntos.length} conjunto(s) en ${cuentaSel?.nombre}. Queda PAUSADA. ¿Seguimos?`)) return;
    setCreando(true);
    const L = (s: string) => setLog((l) => [...l, s]);
    setLog([]);
    try {
      // Si faltan copys, se generan solos con la idea antes de publicar.
      let cs = conjuntos;
      const faltan = cs.reduce((s, c) => s + c.ads.filter((a) => !a.texto.trim()).length, 0);
      if (faltan) {
        L(`Generando ${faltan} copys con la idea…`);
        const { copys } = await post('/api/anuncios/copys', { idea, cantidad: faltan });
        let k = 0;
        cs = cs.map((c) => ({
          ...c, ads: c.ads.map((a) => {
            if (a.texto.trim()) return a;
            const cp = copys[k++ % copys.length];
            return { ...a, texto: cp.texto, titulo: cp.titulo };
          }),
        }));
        setConjuntos(cs);
        L('✓ Copys listos');
      }
      L('Creando campaña CBO…');
      const { id: campId } = await post('/api/anuncios/paso', { accion: 'campana', cuenta, nombre: campana, presupuesto });
      L(`✓ Campaña ${campId}`);
      const subidos: Record<string, { hash?: string; videoId?: string; miniatura?: string }> = {};
      for (const c of cs) {
        L(`Creando ${c.nombre}…`);
        const { id: setId } = await post('/api/anuncios/paso', { accion: 'conjunto', cuenta, campana: campId, nombre: c.nombre, pixel });
        L(`✓ ${c.nombre} (${setId})`);
        for (const [ai, a] of c.ads.entries()) {
          const arch = archivos.find((x) => x.id === a.archivo)!;
          if (!subidos[arch.id]) {
            L(`Subiendo ${arch.nombre}${arch.tipo === 'video' ? ' (los videos tardan un rato)' : ''}…`);
            subidos[arch.id] = await post('/api/anuncios/paso', { accion: 'media', cuenta, fileId: arch.id, nombre: arch.nombre, tipo: arch.tipo });
          }
          const nombre = `${c.nombre} - Ad ${ai + 1} - ${arch.nombre}`;
          const { id: adId } = await post('/api/anuncios/paso', {
            accion: 'anuncio', cuenta, conjunto: setId, nombre, tipo: arch.tipo, ...subidos[arch.id],
            texto: a.texto, titulo: a.titulo, link, cta, pagina, instagram: instagram || undefined,
          });
          L(`✓ ${nombre} (${adId})`);
        }
      }
      L('🎉 Listo. La campaña quedó PAUSADA: revisala en el Administrador de anuncios y prendela.');
    } catch (e) {
      L(`✗ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    setCreando(false);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Carga de anuncios" subtitle="Drive → Meta · campaña CBO, todo pausado" width="5xl" />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">

        <section className={card}>
          <h2 className="font-semibold mb-3">1 · Carpeta de Drive</h2>
          <p className="text-xs text-slate-500 mb-3">
            Compartí la carpeta (Lector) con <span className="text-slate-300 select-all">mateando-sa@mateando-claude.iam.gserviceaccount.com</span> y pegá el link.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input className={input} placeholder="https://drive.google.com/drive/folders/…" value={carpeta} onChange={(e) => setCarpeta(e.target.value)} />
            <button className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap`} disabled={!carpeta || cargandoDrive} onClick={leerCarpeta}>
              {cargandoDrive ? 'Leyendo…' : 'Leer carpeta'}
            </button>
          </div>
          {errDrive && <p className="text-sm text-rose-400 mt-2">{errDrive}</p>}
          {archivos.length > 0 && (
            <>
              <p className="text-xs text-slate-400 mt-3">
                {archivos.filter((a) => a.tipo === 'imagen').length} imágenes · {archivos.filter((a) => a.tipo === 'video').length} videos
                {' → '}<span className="text-emerald-300">{conjuntos.length} conjuntos de 3 armados solos</span>
              </p>
              {(['imagen', 'video'] as const).map((t) => {
                const sobran = archivos.filter((a) => a.tipo === t).length % POR_CONJUNTO;
                return sobran ? (
                  <p key={t} className="text-xs text-amber-400 mt-1">
                    Quedan {sobran} {t === 'imagen' ? 'imagen(es)' : 'video(s)'} sin usar: hacen falta 3 para armar otro conjunto.
                  </p>
                ) : null;
              })}
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2">
                {archivos.map((a) => (
                  <div key={a.id} className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {a.miniatura ? <img src={a.miniatura} alt="" referrerPolicy="no-referrer" className="aspect-square object-cover w-full" /> : <div className="aspect-square" />}
                    <p className="text-[10px] px-1 py-0.5 truncate text-slate-400">{a.tipo === 'video' ? '🎬' : '🖼️'} {a.nombre}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        <section className={card}>
          <h2 className="font-semibold mb-3">2 · Campaña CBO</h2>
          {errCuentas && <p className="text-sm text-amber-400 mb-2">{errCuentas}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <label className="space-y-1"><span className="text-slate-400">Cuenta publicitaria</span>
              <select className={input} value={cuenta} onChange={(e) => { setCuenta(e.target.value); setPixel(cuentas.find((c) => c.id === e.target.value)?.pixeles[0]?.id ?? ''); }}>
                {cuentas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.moneda})</option>)}
              </select></label>
            <label className="space-y-1"><span className="text-slate-400">Píxel (optimiza a Compra)</span>
              <select className={input} value={pixel} onChange={(e) => setPixel(e.target.value)}>
                <option value="">Sin píxel (clics)</option>
                {cuentaSel?.pixeles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select></label>
            <label className="space-y-1"><span className="text-slate-400">Nombre de la campaña</span>
              <input className={input} value={campana} onChange={(e) => setCampana(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-slate-400">Presupuesto diario CBO ({cuentaSel?.moneda ?? 'ARS'})</span>
              <input type="number" className={input} value={presupuesto} onChange={(e) => setPresupuesto(Number(e.target.value))} /></label>
            <label className="space-y-1"><span className="text-slate-400">Link de destino</span>
              <input className={input} value={link} onChange={(e) => setLink(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-slate-400">Botón</span>
              <select className={input} value={cta} onChange={(e) => setCta(e.target.value)}>{CTAS.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="space-y-1"><span className="text-slate-400">Página de Facebook (ID)</span>
              <input className={input} value={pagina} onChange={(e) => setPagina(e.target.value)} /></label>
            <label className="space-y-1"><span className="text-slate-400">Instagram (ID, opcional)</span>
              <input className={input} value={instagram} onChange={(e) => setInstagram(e.target.value)} /></label>
          </div>
        </section>

        <section className={card}>
          <h2 className="font-semibold mb-3">3 · Idea del copy</h2>
          <textarea className={`${input} min-h-24`} placeholder="Ej: termo Stanley-style a mitad de precio, 3 cuotas sin interés, envío gratis a todo el país…" value={idea} onChange={(e) => setIdea(e.target.value)} />
          <p className="text-xs text-slate-500 mt-1">Al publicar, los copys se generan solos con esta idea. Si querés verlos antes, tocá el botón.</p>
          <button className={`${btn} mt-2 bg-slate-800 hover:bg-slate-700`} disabled={!idea.trim() || generando} onClick={generarCopys}>
            {generando ? 'Generando…' : '✨ Ver copys antes de publicar'}
          </button>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold mr-auto">4 · Conjuntos y anuncios</h2>
            <button className={`${btn} bg-slate-800 hover:bg-slate-700`} disabled={!archivos.length} onClick={autoAsignar}>Repartir archivos</button>
            <button className={`${btn} bg-slate-800 hover:bg-slate-700`} onClick={() => setConjuntos((cs) => [...cs, nuevoConjunto(cs.length + 1)])}>+ Conjunto</button>
          </div>
          {conjuntos.map((c, ci) => (
            <div key={ci} className={card}>
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <input className={`${input} sm:w-56`} value={c.nombre} onChange={(e) => upd(ci, (x) => ({ ...x, nombre: e.target.value }))} />
                <div className="flex rounded-lg overflow-hidden border border-slate-800 text-sm">
                  {(['imagen', 'video'] as const).map((t) => (
                    <button key={t} className={`px-3 py-2 ${c.tipo === t ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400'}`}
                      onClick={() => upd(ci, (x) => ({ ...x, tipo: t, ads: x.ads.map((a) => ({ ...a, archivo: '' })) }))}>
                      {t === 'imagen' ? '🖼️ Imágenes' : '🎬 Videos'}
                    </button>
                  ))}
                </div>
                <button className={`${btn} ml-auto text-rose-400 hover:bg-rose-500/10`} disabled={conjuntos.length === 1} onClick={() => setConjuntos((cs) => cs.filter((_, i) => i !== ci))}>Quitar</button>
              </div>
              <div className="space-y-3">
                {c.ads.map((a, ai) => {
                  const arch = archivos.find((x) => x.id === a.archivo);
                  return (
                    <div key={ai} className="grid grid-cols-[56px_1fr] gap-3 border-t border-slate-800 pt-3">
                      <div className="w-14 h-14 rounded-md bg-slate-950 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {arch?.miniatura && <img src={arch.miniatura} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />}
                      </div>
                      <div className="space-y-2 min-w-0">
                        <div className="flex gap-2">
                          <select className={input} value={a.archivo} onChange={(e) => updAd(ci, ai, { archivo: e.target.value })}>
                            <option value="">Anuncio {ai + 1}: elegí {c.tipo === 'imagen' ? 'imagen' : 'video'}…</option>
                            {archivos.filter((x) => x.tipo === c.tipo).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                          </select>
                          <button className={`${btn} text-slate-500 hover:text-rose-400`} disabled={c.ads.length === 1}
                            onClick={() => upd(ci, (x) => ({ ...x, ads: x.ads.filter((_, i) => i !== ai) }))}>✕</button>
                        </div>
                        <textarea className={`${input} min-h-16`} placeholder="Texto principal" value={a.texto} onChange={(e) => updAd(ci, ai, { texto: e.target.value })} />
                        <input className={input} placeholder="Título" value={a.titulo} onChange={(e) => updAd(ci, ai, { titulo: e.target.value })} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <button className={`${btn} mt-3 bg-slate-800 hover:bg-slate-700`} onClick={() => upd(ci, (x) => ({ ...x, ads: [...x.ads, { archivo: '', texto: '', titulo: '' }] }))}>+ Anuncio</button>
            </div>
          ))}
        </section>

        <section className={card}>
          {problemas.length > 0 && (
            <ul className="text-xs text-amber-400 mb-3 list-disc pl-4 space-y-0.5">
              {[...new Set(problemas)].slice(0, 8).map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <button className={`${btn} w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white text-base`} disabled={problemas.length > 0 || creando} onClick={crear}>
            {creando ? 'Publicando en Meta…' : 'Publicar en Meta (queda pausada)'}
          </button>
          {log.length > 0 && (
            <pre className="mt-3 text-xs bg-slate-950 rounded-lg p-3 whitespace-pre-wrap text-slate-300">{log.join('\n')}</pre>
          )}
        </section>
      </main>
    </div>
  );
}
