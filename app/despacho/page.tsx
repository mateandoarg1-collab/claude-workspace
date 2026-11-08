'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '../components/AppHeader';

type Escaneo = { fecha: string; envio: string; orden: string; quien: string };
type Res = { ok: boolean; envio: string | null; orden: string | null; repetido?: boolean; error?: string };

// Pitido corto sin archivos: agudo = bien, grave = error.
function pitar(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = ok ? 1200 : 300;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.4));
  } catch {}
  try { navigator.vibrate?.(ok ? 80 : [200, 80, 200]); } catch {}
}

export default function Despacho() {
  const [quien, setQuien] = useState('');
  const [res, setRes] = useState<Res | null>(null);
  const [hoy, setHoy] = useState<Escaneo[]>([]);
  const [activo, setActivo] = useState(false);
  const [manual, setManual] = useState('');
  const [errorCam, setErrorCam] = useState('');
  const [estadoCam, setEstadoCam] = useState('');
  const ocupado = useRef(false);
  const ultimo = useRef<{ c: string; t: number }>({ c: '', t: 0 });
  const lector = useRef<{ stop: () => Promise<void> } | null>(null);

  useEffect(() => {
    try { setQuien(localStorage.getItem('despacho-quien') ?? ''); } catch {}
    cargar();
  }, []);
  const cargar = () => fetch('/api/despacho').then((r) => r.json()).then((d) => d.hoy && setHoy(d.hoy)).catch(() => {});

  const enviar = useCallback(async (codigo: string) => {
    const ahora = Date.now();
    // la cámara lee el mismo código muchas veces por segundo: ignorar repeticiones por 4 s
    if (ocupado.current || (codigo === ultimo.current.c && ahora - ultimo.current.t < 4000)) return;
    ultimo.current = { c: codigo, t: ahora };
    ocupado.current = true;
    try {
      const r: Res = await fetch('/api/despacho', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ codigo, quien }) }).then((x) => x.json());
      setRes(r);
      pitar(r.ok);
      if (r.ok) cargar();
    } catch (e) {
      setRes({ ok: false, envio: null, orden: null, error: 'Sin conexión: ' + String(e) });
      pitar(false);
    } finally {
      ocupado.current = false;
    }
  }, [quien]);

  const enviarRef = useRef(enviar);
  enviarRef.current = enviar;

  // El recuadro tiene que estar visible antes de arrancar: con display:none mide 0 y el lector falla.
  async function prender() {
    setErrorCam('');
    setActivo(true);
    await new Promise((r) => setTimeout(r, 50));
    const conTiempo = <T,>(p: Promise<T>, ms: number, msg: string) =>
      Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no deja usar la cámara. Abrí el link en Chrome o Safari (no desde WhatsApp ni Instagram).');
      // 1) pedir la cámara directo (así aparece el cartel de permiso del celular) y soltarla
      setEstadoCam('Pidiendo permiso para la cámara…');
      const prueba = await conTiempo(navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }), 20000, 'El celular no respondió al pedido de cámara. Revisá que el navegador tenga permiso de cámara en Ajustes.');
      prueba.getTracks().forEach((t) => t.stop());
      // 2) arrancar el lector (sin recuadro: en algunos celulares deja la imagen en negro)
      setEstadoCam('Abriendo cámara…');
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = await import('html5-qrcode');
      const h = new Html5Qrcode('camara', { formatsToSupport: [F.CODE_128, F.QR_CODE, F.CODE_39, F.ITF], verbose: false });
      await conTiempo(h.start({ facingMode: 'environment' }, { fps: 10 }, (texto) => enviarRef.current(texto), () => {}), 10000, 'La cámara no arrancó. Cerrá otras apps que la usen y probá de nuevo.');
      lector.current = h;
      setEstadoCam('');
    } catch (e) {
      setEstadoCam('');
      setActivo(false);
      const m = e instanceof Error ? e.message : String(e);
      setErrorCam(/NotAllowed|Permission/i.test(m) ? 'No hay permiso para la cámara: tocá el candado de la barra de direcciones y permitila.' : m);
    }
  }
  async function apagar() {
    await lector.current?.stop().catch(() => {});
    lector.current = null;
    setActivo(false);
  }
  useEffect(() => () => { lector.current?.stop().catch(() => {}); }, []);

  const color = !res ? 'border-slate-800 bg-slate-900' : res.ok ? 'border-emerald-500 bg-emerald-500/20' : 'border-red-500 bg-red-500/20';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Despacho" subtitle="Escaneá la etiqueta de OCA al terminar de embalar" width="4xl" />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        <input
          value={quien}
          onChange={(e) => { setQuien(e.target.value); try { localStorage.setItem('despacho-quien', e.target.value); } catch {} }}
          placeholder="Tu nombre"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base placeholder:text-slate-500 focus:border-emerald-500 outline-none"
        />

        <div id="camara" className={`w-full overflow-hidden rounded-2xl bg-black ${activo ? 'min-h-64' : 'hidden'}`} />
        {activo ? (
          <button onClick={apagar} className="w-full rounded-xl border border-slate-700 py-2 text-slate-300">Apagar cámara</button>
        ) : (
          <button onClick={prender} disabled={!quien.trim()} className="w-full rounded-xl bg-emerald-600 py-4 text-lg font-semibold disabled:opacity-40">
            {quien.trim() ? '📷 Escanear etiquetas' : 'Poné tu nombre para empezar'}
          </button>
        )}

        {estadoCam && <div className="text-center text-sm text-slate-300">{estadoCam}</div>}
        {errorCam &&<div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">{errorCam}</div>}
        <div className={`rounded-2xl border-2 p-5 text-center transition-colors ${color}`}>
          {!res && <div className="text-slate-400">Apuntá al código de barras de la etiqueta</div>}
          {res?.ok && (
            <>
              <div className="text-3xl font-bold">✓ #{res.orden}</div>
              <div className="text-emerald-200">Embalada</div>
            </>
          )}
          {res && !res.ok && (
            <>
              <div className="text-2xl font-bold">✗ {res.orden ? `#${res.orden}` : 'Error'}</div>
              <div className="text-red-200">{res.error}</div>
            </>
          )}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { enviar(manual.trim()); setManual(''); } }} className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" placeholder="O tipeá el N° de guía" className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm placeholder:text-slate-500 outline-none" />
          <button disabled={!quien.trim()} className="rounded-lg border border-slate-700 px-4 text-sm disabled:opacity-40">Cargar</button>
        </form>

        <section className="bg-slate-900 rounded-2xl border border-slate-800 p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-2">Embaladas hoy <span className="tabular-nums text-emerald-300">{hoy.length}</span></h2>
          <ul className="text-sm divide-y divide-slate-800">
            {hoy.slice(0, 50).map((e) => (
              <li key={e.envio} className="py-1.5 flex justify-between gap-2">
                <span className="tabular-nums">#{e.orden}</span>
                <span className="text-slate-400 truncate">{e.quien} · {new Date(e.fecha).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
