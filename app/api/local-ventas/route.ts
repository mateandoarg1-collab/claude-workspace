import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { agregarMovimiento } from '@/lib/localEfectivo';
import { getPagosLocal } from '@/lib/mercadopago';

export const dynamic = 'force-dynamic';

// Ventas de la caja del local (mateando-local.vercel.app). Desde el 8-nov-2026 el local va separado de Empretienda:
// cada venta se guarda acá con N° de pedido propio y correlativo, en la pestaña "Ventas Caja" de la planilla
// "Mateando_Flujo_Efectivo COSTA RICA". GET lista (más nuevas primero); POST guarda una venta o anula ({anular: nro}).
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const HOJA = 'Ventas Caja';
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type,x-pin' };

function sinPermiso(req: Request) {
  const pin = process.env.LOCAL_CAJA_PIN;
  if (!pin || req.headers.get('x-pin') === pin) return null;
  return Response.json({ error: 'Clave incorrecta' }, { status: 401, headers: CORS });
}
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });
const filas = async () => (await sheets().spreadsheets.values.get({ spreadsheetId: ID, range: `'${HOJA}'!A2:R`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
const n = (x: unknown) => Math.round(Number(x) || 0);
// Partes del pago (col R, JSON): [{medio, pesos, cotiz?, monto?}]. Ventas viejas sin R: una sola parte con el total.
type Parte = { medio: string; pesos: number; cotiz?: number; monto?: number };
function leerPagos(f: string[]): Parte[] {
  try { const p = JSON.parse(f[17] || ''); if (Array.isArray(p) && p.length) return p; } catch {}
  return [{ medio: f[5], pesos: n(f[10]) }];
}
// Lo que entra o sale de la caja de efectivo por cada parte en efectivo (pesos, dólares o euros).
async function moverEfectivo(pagos: Parte[], tipo: 'Ingreso' | 'Egreso', detalle: string) {
  for (const p of pagos) {
    if (p.medio === 'Efectivo' && p.pesos) await agregarMovimiento({ tipo, categoria: 'Ventas mostrador', detalle, pesos: p.pesos });
    if ((p.medio === 'USD' || p.medio === 'EUR') && p.monto) {
      const m = tipo === 'Ingreso' ? p.monto : -p.monto;
      await agregarMovimiento({ tipo, categoria: 'Ventas mostrador', detalle: `${detalle} · ${p.medio} ${p.monto} a $${p.cotiz}`, ...(p.medio === 'USD' ? { usd: m } : { eur: m }) });
    }
  }
}
const txt = (x: unknown, max: number) => String(x ?? '').slice(0, max);

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

// Une las ventas con tarjeta/QR de los últimos 2 días con los pagos de Mercado Pago (Point/QR del local) por horario:
// el pago más cercano entre 20 min antes y 10 min después de guardar la venta, priorizando el mismo monto. El id del
// pago queda en la columna Q ("MP 123…"), así cada pago se usa una sola vez.
const CON_MP = new Set(['Débito', 'Crédito', 'QR MP']);
const horaVenta = (f: unknown) => Date.parse(String(f).replace(' ', 'T') + ':00-03:00');
async function unirConMP(v: string[][]) {
  const desde = Date.now() - 2 * 864e5;
  const mpDe = (f: string[]) => leerPagos(f).filter((p) => CON_MP.has(p.medio)).reduce((s, p) => s + p.pesos, 0);
  const pend = v.map((f, i) => ({ f, i })).filter(({ f }) => f[0] && mpDe(f) > 0 && f[14] !== 'anulada' && !f[16] && horaVenta(f[1]) >= desde);
  if (!pend.length) return;
  const pagos = await getPagosLocal('NOW-3DAYS', 'NOW') // MP no acepta fechas ISO en Z: devuelve 0;
  const usados = new Set(v.map((f) => (String(f[16] ?? '').match(/MP (\d+)/)?.[1] ?? '')).filter(Boolean));
  const libres = pagos.filter((p) => !usados.has(String(p.id)));
  const cambios: { range: string; values: string[][] }[] = [];
  for (const { f, i } of pend.sort((a, b) => horaVenta(a.f[1]) - horaVenta(b.f[1]))) {
    const t = horaVenta(f[1]), total = mpDe(f);
    const lejos = (p: { monto: number }) => (Math.abs(p.monto - total) > 1 ? 1 : 0);
    const cand = libres.filter((p) => p.fecha >= t - 20 * 60e3 && p.fecha <= t + 10 * 60e3)
      .sort((a, b) => lejos(a) - lejos(b) || Math.abs(a.fecha - t) - Math.abs(b.fecha - t));
    const p = cand[0]; if (!p) continue;
    libres.splice(libres.indexOf(p), 1);
    // "MP 123 · Visa crédito": la tarjeta con la que pagó, para verla en el historial
    const TIPO: Record<string, string> = { credit_card: 'crédito', debit_card: 'débito', prepaid_card: 'prepaga', account_money: 'dinero en cuenta' };
    const marca = p.marca === 'account_money' ? '' : p.marca.replace(/^deb(?=[a-z])/, '').replace(/^\w/, (c) => c.toUpperCase());
    const tarjeta = [marca, TIPO[p.tipo] ?? p.tipo].filter(Boolean).join(' ');
    const txtMP = `MP ${p.id}${tarjeta ? ` · ${tarjeta}` : ''}${lejos(p) ? ` (cobró $${Math.round(p.monto)})` : ''}`;
    f[16] = txtMP;
    cambios.push({ range: `'${HOJA}'!Q${i + 2}`, values: [[txtMP]] });
  }
  if (cambios.length) await sheets().spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: 'RAW', data: cambios } });
}

export async function GET(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const v = await filas();
    let mpError = '';
    await unirConMP(v).catch((e) => { mpError = e instanceof Error ? e.message : String(e); });
    const ventas = v.filter((f) => f[0]).map((f) => {
      let items = []; try { items = JSON.parse(f[15] || '[]'); } catch {}
      return { nro: n(f[0]), fecha: f[1], dia: f[2], hora: f[3], cajera: f[4], medio: f[5], sub: n(f[6]), dTransf: n(f[7]), conDesc: n(f[8]),
        d: Number(f[9]) || 0, total: n(f[10]), unidades: n(f[11]), com: f[13] ?? '', estado: f[14] || 'ok', mp: f[16] ?? '', pagos: leerPagos(f), items };
    }).reverse();
    return Response.json({ ventas, mpError }, { headers: { ...CORS, 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export async function POST(req: Request) {
  const no = sinPermiso(req); if (no) return no;
  try {
    const b = await req.json();
    const v = await filas();
    if (b.anular) {
      const i = v.findIndex((f) => n(f[0]) === n(b.anular));
      if (i < 0) return Response.json({ error: 'No existe ese pedido' }, { status: 404, headers: CORS });
      if (v[i][14] === 'anulada') return Response.json({ ok: true }, { headers: CORS });
      await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!O${i + 2}`, valueInputOption: 'RAW', requestBody: { values: [['anulada']] } });
      // si fue en efectivo, sale la plata de la caja (contramovimiento en Movimientos)
      await moverEfectivo(leerPagos(v[i]), 'Egreso', `Anulación pedido N° ${n(b.anular)}`);
      return Response.json({ ok: true }, { headers: CORS });
    }
    // Editar un pedido ya cobrado: se cambian productos, quién cobró y comentario. El total y los pagos quedan como se
    // cobraron (la plata ya entró); si el nuevo detalle suma distinto, queda anotado en el comentario.
    if (b.editar) {
      const i = v.findIndex((f) => n(f[0]) === n(b.editar));
      if (i < 0) return Response.json({ error: 'No existe ese pedido' }, { status: 404, headers: CORS });
      const its = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((x: Record<string, unknown>) => ({
        nombre: txt(x.nombre, 160), cant: n(x.cant) || 1, precio: n(x.precio), local: !!x.local, n: txt(x.n, 160), v: txt(x.v, 200) }));
      if (!its.length) return Response.json({ error: 'Venta sin productos' }, { status: 400, headers: CORS });
      const fila = v[i];
      const cajera = txt(b.cajera || fila[4], 40), com = txt(b.com ?? fila[13], 300);
      await sheets().spreadsheets.values.batchUpdate({ spreadsheetId: ID, requestBody: { valueInputOption: 'RAW', data: [
        { range: `'${HOJA}'!E${i + 2}`, values: [[cajera]] },
        { range: `'${HOJA}'!L${i + 2}:N${i + 2}`, values: [[its.reduce((s: number, x: { cant: number }) => s + x.cant, 0),
          its.map((x: { cant: number; nombre: string }) => `${x.cant}x ${x.nombre}`).join(' | '), com]] },
        { range: `'${HOJA}'!P${i + 2}`, values: [[JSON.stringify(its)]] },
      ] } });
      return Response.json({ ok: true }, { headers: CORS });
    }
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 100).map((i: Record<string, unknown>) => ({
      nombre: txt(i.nombre, 160), cant: n(i.cant) || 1, precio: n(i.precio), local: !!i.local, n: txt(i.n, 160), v: txt(i.v, 200) }));
    if (!items.length) return Response.json({ error: 'Venta sin productos' }, { status: 400, headers: CORS });
    const nro = Math.max(0, ...v.map((f) => n(f[0]))) + 1;
    const pagos: Parte[] = (Array.isArray(b.pagos) && b.pagos.length ? b.pagos : [{ medio: b.medio, pesos: b.total }]).slice(0, 4).map((p: Record<string, unknown>) => ({
      medio: txt(p.medio, 20), pesos: n(p.pesos), ...(p.cotiz ? { cotiz: Number(p.cotiz) || 0, monto: Math.round((Number(p.monto) || 0) * 100) / 100 } : {}) }));
    const ahora = new Date(Date.now() - 3 * 3600e3);
    const dia = ahora.toISOString().slice(0, 10).split('-').reverse().join('/');
    const hora = ahora.toISOString().slice(11, 16);
    const fila = [nro, ahora.toISOString().slice(0, 16).replace('T', ' '), dia, hora, txt(b.cajera, 40), txt(b.medio, 30), n(b.sub), n(b.dTransf),
      n(b.conDesc), Number(b.d) || 0, n(b.total), items.reduce((s: number, i: { cant: number }) => s + i.cant, 0),
      items.map((i: { cant: number; nombre: string }) => `${i.cant}x ${i.nombre}`).join(' | '), txt(b.com, 300), 'ok', JSON.stringify(items), '', JSON.stringify(pagos)];
    await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!A${v.length + 2}:R${v.length + 2}`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
    // Venta en efectivo: entra la plata en la planilla de efectivo (Movimientos), sin cargarla dos veces.
    let efectivo = null;
    if (pagos.some((p) => ['Efectivo', 'USD', 'EUR'].includes(p.medio))) {
      try { await moverEfectivo(pagos, 'Ingreso', `Pedido N° ${nro} · ${fila[4]}`); efectivo = 'ok'; }
      catch (e) { efectivo = e instanceof Error ? e.message : String(e); }
    }
    return Response.json({ ok: true, nro, dia, hora, efectivo }, { headers: CORS });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}
