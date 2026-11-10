import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { cuitValido, emitirFactura, facturaDePagoMP, type FacturaLocal } from '@/lib/ecommapp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Facturas de la caja del local (Juampi, 10-nov-2026):
//   - Lo cobrado con Mercado Pago (Débito, Crédito, QR MP) lo factura SOLO Ecomm-App por el canal Mercado Pago. Acá
//     solo se busca esa factura (GET ?nro=) para imprimirla o mandarla. Nunca se emite otra.
//   - Efectivo / transferencia / USD / EUR no se factura, SALVO que el cliente la pida a su CUIT/CUIL: POST {nro,
//     documento, email?} emite por la API de Ecomm-App en el punto de venta 5 (Local Mateando – calle Costa Rica).
// La factura queda guardada en la columna T de "Ventas Caja" (JSON) para no buscarla ni emitirla dos veces.
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const HOJA = 'Ventas Caja';
const PUNTO_VENTA_LOCAL = 5;
const CON_MP = new Set(['Débito', 'Crédito', 'QR MP']);
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { ...CORS, 'cache-control': 'no-store' } });
const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

type Parte = { medio: string; pesos: number };
const pagosDe = (f: unknown[]): Parte[] => { try { const p = JSON.parse(String(f[17] || '')); if (Array.isArray(p) && p.length) return p; } catch {} return [{ medio: String(f[5]), pesos: Number(f[10]) || 0 }]; };
const guardada = (f: unknown[]): FacturaLocal | null => { try { return f[19] ? JSON.parse(String(f[19])) : null; } catch { return null; } };

async function fila(nro: number) {
  let v: unknown[][] = [];
  for (let k = 0; ; k++) { // Google limita lecturas por minuto (cupo compartido con los paneles): esperar y reintentar
    try { v = (await sheets().spreadsheets.values.get({ spreadsheetId: ID, range: `'${HOJA}'!A2:T`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? []; break; }
    catch (e) { if (k >= 3 || !/quota|rate/i.test(String(e))) throw e; await new Promise((r) => setTimeout(r, 4000 * (k + 1))); }
  }
  const i = v.findIndex((f) => Number(f[0]) === nro);
  const usadas = new Set(v.map((f) => guardada(f)?.numero ?? '').filter(Boolean));
  return i < 0 ? null : { f: v[i], celda: `'${HOJA}'!T${i + 2}`, usadas };
}
const guardar = (celda: string, fa: FacturaLocal) =>
  sheets().spreadsheets.values.update({ spreadsheetId: ID, range: celda, valueInputOption: 'RAW', requestBody: { values: [[JSON.stringify(fa)]] } });

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    // TEMPORAL: ver cómo trae Ecomm-App los comprobantes de un monto (con la clave de Métricas)
    if (u.searchParams.get('debug') && process.env.LOCAL_METRICAS_CLAVE && req.headers.get('x-clave') === process.env.LOCAL_METRICAS_CLAVE) {
      const { comprobantesDelDia } = await import('@/lib/ecommapp');
      if (u.searchParams.get('raw')) {
        const { llamar } = await import('@/lib/ecommapp');
        const q = new URLSearchParams({ date_from: String(u.searchParams.get('dia')), date_to: String(u.searchParams.get('dia')), per_page: '5' });
        const j = await llamar(`/comprobantes?${q}`).catch((e) => ({ fallo: String(e) }));
        const forma = (o: unknown, d = 0): unknown => d > 2 || o == null || typeof o !== 'object' ? typeof o : Array.isArray(o) ? [o.length, forma(o[0], d + 1)] : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, forma(v, d + 1)]));
        return json({ forma: forma(j), fallo: (j as { fallo?: string }).fallo });
      }
      const todos = await comprobantesDelDia(String(u.searchParams.get('dia')));
      const monto = Number(u.searchParams.get('monto'));
      return json({ cantidad: todos.length, canales: [...new Set(todos.map((c) => c.invoice?.sales_channel))], claves: Object.keys(todos[0] ?? {}),
        invoiceKeys: Object.keys(todos[0]?.invoice ?? {}), match: todos.filter((c) => Math.abs((Number(c.amounts?.total) || 0) - monto) < 1).map((c) => ({ ...c.invoice, total: c.amounts?.total, amounts: c.amounts, items: (c as { items?: unknown }).items })) });
    }
    const nro = Number(u.searchParams.get('nro'));
    const x = nro > 0 ? await fila(nro) : null;
    if (!x) return json({ error: 'No existe ese pedido' }, 404);
    const ya = guardada(x.f);
    if (ya) return json({ factura: ya });
    const mpPesos = pagosDe(x.f).filter((p) => CON_MP.has(p.medio)).reduce((s, p) => s + p.pesos, 0);
    if (!mpPesos) return json({ factura: null, puedeFacturar: x.f[14] !== 'anulada' });
    const mp = String(x.f[16] ?? '').match(/MP (\d+)/);
    if (!mp) return json({ factura: null, pendiente: 'Todavía no se encontró el pago en Mercado Pago' });
    const cobro = Number(String(x.f[16]).match(/cobró \$(\d+)/)?.[1]) || mpPesos;
    const [d, m, a] = String(x.f[2]).split('/');
    const dia = `${a}-${m}-${d}`, sig = new Date(Date.parse(dia + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
    const fa = await facturaDePagoMP([dia, sig], cobro, Date.parse(String(x.f[1]).replace(' ', 'T') + ':00-03:00'), x.usadas);
    if (!fa) return json({ factura: null, pendiente: 'Ecomm-App todavía no hizo la factura de este pago (se hace sola, probá en unos minutos)' });
    await guardar(x.celda, fa);
    return json({ factura: fa });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    // TEMPORAL: presupuesto de prueba (no va a ARCA) para ver si unit_price va con o sin IVA y cómo aplica la bonificación
    if (b.pruebaPresupuesto && process.env.LOCAL_METRICAS_CLAVE && req.headers.get('x-clave') === process.env.LOCAL_METRICAS_CLAVE) {
      const { llamar } = await import('@/lib/ecommapp');
      const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      const j = await llamar('/emitir', { method: 'POST', headers: { 'Idempotency-Key': 'mateando-local-prueba-presupuesto-1' }, body: JSON.stringify({
        invoice_type_source: 'tipo_presupuesto', invoice_type_id: 1, quote_type_id: 1, document_number: '30717612503', concept_id: 1, issue_date: hoy,
        point_of_sale: PUNTO_VENTA_LOCAL, notes: 'PRUEBA caja local - borrar', client_reference: 'PRUEBA-CAJA',
        items: [{ description: 'PRUEBA caja local (borrar)', quantity: 1, unit_price: 12100, vat_rate_id: 5, discount_percentage: 10 }] }) }).catch((e) => ({ fallo: String(e) }));
      const d = (j as { data?: { amounts?: unknown; items?: unknown; invoice?: unknown; pdf?: unknown } }).data;
      return json({ fallo: (j as { fallo?: string }).fallo, amounts: d?.amounts, items: d?.items, invoice: d?.invoice, pdf: d?.pdf, claves: Object.keys(d ?? j ?? {}) });
    }
    const nro = Number(b.nro), documento = String(b.documento ?? '').replace(/\D/g, '');
    const email = String(b.email ?? '').trim();
    // Hasta verificar con un presupuesto de prueba si Ecomm-App toma unit_price con o sin IVA, no se emite nada.
    if (process.env.LOCAL_FACTURA_CUIT !== '1') return json({ error: 'Facturar a CUIT todavía está en prueba: hacela desde Ecomm-App por ahora' }, 503);
    if (!cuitValido(documento)) return json({ error: 'El CUIT/CUIL no es válido (son 11 números)' }, 400);
    const x = nro > 0 ? await fila(nro) : null;
    if (!x) return json({ error: 'No existe ese pedido' }, 404);
    if (x.f[14] === 'anulada') return json({ error: 'El pedido está anulado' }, 400);
    const ya = guardada(x.f);
    if (ya) return json({ factura: ya, yaExistia: true });
    if (pagosDe(x.f).some((p) => CON_MP.has(p.medio)))
      return json({ error: 'Esta venta se cobró con Mercado Pago: la factura la hace sola Ecomm-App, no se puede hacer otra' }, 400);
    let items: { nombre: string; cant: number; precio: number }[] = [];
    try { items = JSON.parse(String(x.f[15] || '[]')); } catch {}
    if (!items.length) return json({ error: 'La venta no tiene productos' }, 400);
    // Descuento (efectivo/transferencia y extra) como bonificación por línea: así el total de la factura = lo cobrado.
    const sub = items.reduce((s, i) => s + i.precio * i.cant, 0), total = Number(x.f[10]) || sub;
    const desc = sub > 0 && total < sub ? Math.round((1 - total / sub) * 1e6) / 1e4 : 0;
    const fa = await emitirFactura({
      clave: `mateando-local-${nro}-${documento}`, documento, puntoVenta: PUNTO_VENTA_LOCAL,
      referencia: `LOCAL-${nro}`, notas: `Local Costa Rica 5651 · Pedido N° ${nro}`, email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : undefined,
      items: items.map((i) => ({ description: i.nombre.replace(/ \[.*?\]/g, '').slice(0, 200), quantity: i.cant, unit_price: i.precio, vat_rate_id: 5, ...(desc ? { discount_percentage: desc } : {}) })),
    });
    await guardar(x.celda, fa);
    return json({ factura: fa, esperado: total });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
