'use client';

import { useEffect, useMemo, useState } from 'react';
import AppHeader from '../components/AppHeader';

type Fila = {
  sku: string; nombre: string; categoria: string; conteo: { fecha: string; cant: number } | null;
  ingresos: number; ajustes: number; full: number; vendido: number; porCanal: Record<string, number>;
  stock: number | null; ritmo: number; dias: number | null; ultimoIngreso: string;
};
type Mov = { fecha: string; tipo: string; sku: string; producto: string; cant: number; quien: string; nota: string };
type Sin = { canal: string; clave: string; descripcion: string; unidades: number };
type Datos = { actualizado: string; filas: Fila[]; ultimos: Mov[]; sinTraducir: Sin[]; errores: string[] };

const TIPOS = [
  { t: 'Ingreso', d: 'Llegó mercadería' },
  { t: 'Salida Full', d: 'Se armó un envío a Full' },
  { t: 'Conteo', d: 'Contamos lo que hay (al cierre del día)' },
  { t: 'Ajuste', d: 'Rotura, regalo, error (+ o −)' },
] as const;
const n = (x: number) => x.toLocaleString('es-AR');
const leerLS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const guardarLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function StockPage() {
  const [d, setD] = useState<Datos | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'cargar' | 'stock' | 'revisar'>('cargar');
  const cargarDatos = () => fetch('/api/stock').then((r) => r.json()).then((x) => (x.error ? setErr(x.error) : setD(x))).catch((e) => setErr(String(e)));
  useEffect(() => { cargarDatos(); }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <AppHeader title="Stock depósito" subtitle={d ? `Actualizado ${d.actualizado}` : 'Cargando…'} />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-4 space-y-4">
        <div className="flex gap-2">
          {([['cargar', 'Cargar'], ['stock', 'Stock'], ['revisar', `Sin traducir${d ? ` (${d.sinTraducir.length})` : ''}`]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-sm ${tab === k ? 'bg-emerald-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-300'}`}>{l}</button>
          ))}
        </div>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        {d?.errores.map((e) => <p key={e} className="text-amber-400 text-sm">⚠ {e}</p>)}
        {!d ? <p className="text-slate-400">Cargando…</p> : tab === 'cargar' ? <Cargar d={d} onOk={cargarDatos} /> : tab === 'stock' ? <Tabla d={d} /> : <Revisar d={d} onOk={cargarDatos} />}
      </main>
    </div>
  );
}

function Buscador({ filas, onElegir }: { filas: Fila[]; onElegir: (f: Fila) => void }) {
  const [q, setQ] = useState('');
  const res = useMemo(() => {
    const ps = sinTildes(q).split(/\s+/).filter(Boolean);
    if (!ps.length) return [];
    return filas.filter((f) => { const t = sinTildes(`${f.nombre} ${f.sku}`); return ps.every((p) => t.includes(p)); }).slice(0, 12);
  }, [q, filas]);
  return (
    <div className="relative">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto (ej: torpedo negro)" className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-base" />
      {res.length > 0 && (
        <div className="absolute z-10 left-0 right-0 mt-1 bg-slate-900 border border-slate-800 rounded-lg max-h-80 overflow-y-auto">
          {res.map((f) => (
            <button key={f.sku} onClick={() => { onElegir(f); setQ(''); }} className="block w-full text-left px-3 py-2 hover:bg-slate-800 border-b border-slate-800 last:border-0">
              <div className="text-sm">{f.nombre}</div>
              <div className="text-xs text-slate-400">{f.sku} · {f.categoria}{f.stock != null ? ` · stock ${n(f.stock)}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Cargar({ d, onOk }: { d: Datos; onOk: () => void }) {
  const [tipo, setTipo] = useState<string>('Ingreso');
  const [quien, setQuien] = useState('');
  const [nota, setNota] = useState('');
  const [items, setItems] = useState<{ f: Fila; cant: string }[]>([]);
  const [msg, setMsg] = useState('');
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setQuien(leerLS('stock-quien')); }, []);

  async function enviar() {
    setMsg('');
    if (!quien.trim()) return setMsg('Poné tu nombre');
    if (!items.length) return setMsg('Agregá al menos un producto');
    if (items.some((i) => i.cant.trim() === '' || isNaN(Number(i.cant)))) return setMsg('Falta la cantidad de algún producto');
    if (!confirm(`¿Cargar ${tipo.toLowerCase()} de ${items.length} producto(s)?`)) return;
    setEnviando(true);
    guardarLS('stock-quien', quien.trim());
    const r = await fetch('/api/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'mov', tipo, quien, nota, items: items.map((i) => ({ sku: i.f.sku, cant: Number(i.cant) })) }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setEnviando(false);
    if (r.error) return setMsg(r.error);
    setItems([]); setNota(''); setMsg(`✓ Cargado (${r.cargados})`);
    onOk();
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TIPOS.map((x) => (
          <button key={x.t} onClick={() => setTipo(x.t)} className={`text-left p-3 rounded-lg border ${tipo === x.t ? 'border-emerald-500 bg-emerald-950/40' : 'border-slate-800 bg-slate-900'}`}>
            <div className="font-medium text-sm">{x.t}</div><div className="text-xs text-slate-400">{x.d}</div>
          </button>
        ))}
      </div>
      <Buscador filas={d.filas} onElegir={(f) => setItems((xs) => (xs.some((x) => x.f.sku === f.sku) ? xs : [...xs, { f, cant: '' }]))} />
      {items.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
          {items.map((it, i) => (
            <div key={it.f.sku} className="flex items-center gap-2 p-2">
              <div className="flex-1 min-w-0"><div className="text-sm truncate">{it.f.nombre}</div><div className="text-xs text-slate-400">{it.f.sku}{it.f.stock != null ? ` · hoy ${n(it.f.stock)}` : ''}</div></div>
              <input inputMode={tipo === 'Ajuste' ? 'text' : 'numeric'} value={it.cant} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, cant: e.target.value } : x)))} placeholder="Cant." className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-2 text-base text-right" />
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="text-slate-500 px-2 text-lg" aria-label="Quitar">×</button>
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="Tu nombre" className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-base" />
        <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Nota (proveedor, remito, motivo…)" className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-3 text-base" />
      </div>
      <button disabled={enviando} onClick={enviar} className="w-full sm:w-auto px-6 py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium">{enviando ? 'Cargando…' : `Cargar ${tipo.toLowerCase()}`}</button>
      {msg && <p className="text-sm text-slate-300">{msg}</p>}
      <div>
        <h3 className="text-sm text-slate-400 mb-2">Últimos movimientos</h3>
        <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800 text-sm">
          {d.ultimos.length === 0 && <p className="p-3 text-slate-500">Todavía no hay movimientos. Empezá con un Conteo de todo el depósito.</p>}
          {d.ultimos.map((m, i) => (
            <div key={i} className="p-2 flex gap-2"><span className="text-slate-500 w-28 shrink-0 text-xs">{m.fecha}</span><span className="flex-1 min-w-0 truncate">{m.tipo}: {m.producto}</span><span className="font-medium">{m.tipo === 'Salida Full' ? '−' : m.tipo === 'Ingreso' ? '+' : ''}{n(m.cant)}</span><span className="text-slate-500 text-xs w-16 truncate hidden sm:block">{m.quien}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Tabla({ d }: { d: Datos }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [soloContados, setSoloContados] = useState(true);
  const cats = [...new Set(d.filas.map((f) => f.categoria))];
  const filas = d.filas.filter((f) => (!cat || f.categoria === cat) && (!soloContados || f.conteo) && sinTildes(`${f.nombre} ${f.sku}`).includes(sinTildes(q)))
    .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));
  const color = (f: Fila) => (f.stock == null ? '' : f.stock <= 0 ? 'text-red-400' : f.dias != null && f.dias <= 15 ? 'text-amber-400' : 'text-emerald-400');
  const contados = d.filas.filter((f) => f.conteo).length;
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Stock = último conteo + ingresos ± ajustes − envíos a Full − ventas (Tienda Online, Local, Shopify, MeLi sin Full, Mayorista). {contados} de {d.filas.length} productos contados.</p>
      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar" className="flex-1 min-w-40 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2" />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-2"><option value="">Todas</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <label className="flex items-center gap-1 text-sm text-slate-300"><input type="checkbox" checked={soloContados} onChange={(e) => setSoloContados(e.target.checked)} /> Solo contados</label>
      </div>
      <div className="overflow-x-auto bg-slate-900 border border-slate-800 rounded-lg">
        <table className="w-full text-sm">
          <thead className="text-slate-400 text-xs"><tr className="border-b border-slate-800">
            <th className="text-left p-2">Producto</th><th className="text-right p-2">Stock</th><th className="text-right p-2">Días</th>
            <th className="text-right p-2 hidden sm:table-cell">Conteo</th><th className="text-right p-2 hidden sm:table-cell">+Ingr.</th><th className="text-right p-2 hidden sm:table-cell">−Full</th><th className="text-right p-2 hidden sm:table-cell">−Ventas</th><th className="text-right p-2 hidden sm:table-cell">Venta/día</th>
          </tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.sku} className="border-b border-slate-800 last:border-0">
                <td className="p-2"><div>{f.nombre}</div><div className="text-xs text-slate-500">{f.sku}{f.vendido ? ` · ${Object.entries(f.porCanal).map(([c, v]) => `${c} ${v}`).join(', ')}` : ''}</div></td>
                <td className={`p-2 text-right font-semibold ${color(f)}`}>{f.stock == null ? '—' : n(f.stock)}</td>
                <td className="p-2 text-right text-slate-300">{f.dias ?? '—'}</td>
                <td className="p-2 text-right hidden sm:table-cell text-slate-400">{f.conteo ? `${n(f.conteo.cant)} (${f.conteo.fecha.slice(5, 10)})` : '—'}</td>
                <td className="p-2 text-right hidden sm:table-cell">{f.ingresos + f.ajustes || ''}</td>
                <td className="p-2 text-right hidden sm:table-cell">{f.full || ''}</td>
                <td className="p-2 text-right hidden sm:table-cell">{f.vendido || ''}</td>
                <td className="p-2 text-right hidden sm:table-cell text-slate-400">{f.ritmo ? f.ritmo.toFixed(1) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filas.length === 0 && <p className="p-3 text-slate-500 text-sm">Nada para mostrar{soloContados ? ' (todavía no hay conteos: destildá "Solo contados")' : ''}.</p>}
      </div>
    </div>
  );
}

function Revisar({ d, onOk }: { d: Datos; onOk: () => void }) {
  const [val, setVal] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function guardar(s: Sin) {
    const k = `${s.canal}|${s.clave}`;
    const r = await fetch('/api/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accion: 'eq', canal: s.canal, clave: s.clave, descripcion: s.descripcion, skus: val[k] ?? '' }) }).then((x) => x.json());
    setMsg((m) => ({ ...m, [k]: r.error ?? '✓ Guardado' }));
    if (!r.error) onOk();
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Ventas que no sé a qué producto del Excel corresponden, así que todavía no descuentan stock. Escribí el SKU (o varios: <code>MATE-CAL-1004 + BOMB-ACE-12001</code>, con <code>*2</code> si van dos), o <code>-</code> si no descuenta nada. Las de Tienda Online/Local (regla) se arreglan en las reglas del CMV: avisale a Claude.</p>
      <div className="bg-slate-900 border border-slate-800 rounded-lg divide-y divide-slate-800">
        {d.sinTraducir.length === 0 && <p className="p-3 text-slate-500 text-sm">Todo traducido 🎉</p>}
        {d.sinTraducir.map((s) => {
          const k = `${s.canal}|${s.clave}`;
          const editable = !s.canal.includes('(regla)');
          return (
            <div key={k + s.descripcion} className="p-2 space-y-1">
              <div className="text-sm"><span className="text-xs text-emerald-400 mr-2">{s.canal}</span>{s.descripcion} <span className="text-slate-500">· {s.unidades} u.</span></div>
              {s.canal === 'MeLi' && <div className="text-xs text-slate-500">{s.clave.replace(/\|$/, '')}</div>}
              {editable && (
                <div className="flex gap-2">
                  <input value={val[k] ?? ''} onChange={(e) => setVal((v) => ({ ...v, [k]: e.target.value }))} placeholder="SKU(s)" className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-sm" />
                  <button onClick={() => guardar(s)} className="px-3 rounded bg-emerald-700 text-sm">Guardar</button>
                </div>
              )}
              {msg[k] && <div className="text-xs text-slate-300">{msg[k]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
