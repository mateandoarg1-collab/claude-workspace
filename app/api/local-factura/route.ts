import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { cuitValido, emitirFactura, facturaDePagoMP, notaDeCreditoTotal, type FacturaLocal } from '@/lib/ecommapp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Facturas de la caja del local (Juampi, 10-nov-2026):
//   - Lo cobrado con Mercado Pago (Débito, Crédito, QR MP) lo factura SOLO Ecomm-App por el canal Mercado Pago. Acá
//     solo se busca esa factura (GET ?nro=) para imprimirla o mandarla. Nunca se emite otra.
//   - Efectivo / transferencia / USD / EUR no se factura, SALVO que el cliente la pida a su CUIT/CUIL: POST {nro,
//     documento, email?} emite por la API de Ecomm-App en el punto de venta 5 (Local Mateando – calle Costa Rica).
//   - Factura A de una venta cobrada con Mercado Pago (12-nov-2026, pedido 77): Ecomm-App ya la facturó sola como B a
//     consumidor final, así que POST {nro, documento, email?, cambiar: true} hace la nota de crédito total de esa B y
//     después la factura nueva al CUIT (punto de venta 5; sale A o B según el padrón de ARCA). Cada paso queda guardado
//     en la columna T, así un reintento no repite la nota de crédito ni la factura.
// Precios: Ecomm-App toma unit_price CON IVA y el descuento como bonificación % (probado con un presupuesto el 10-nov).
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
  // la B que se anuló para hacer una A sigue "tomada": que no se la asigne a otra venta del mismo monto
  const usadas = new Set(v.flatMap((f) => [guardada(f)?.numero ?? '', guardada(f)?.reemplaza ?? '']).filter(Boolean));
  return i < 0 ? null : { f: v[i], celda: `'${HOJA}'!T${i + 2}`, usadas };
}
const guardar = (celda: string, fa: FacturaLocal) =>
  sheets().spreadsheets.values.update({ spreadsheetId: ID, range: celda, valueInputOption: 'RAW', requestBody: { values: [[JSON.stringify(fa)]] } });

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

const diasDe = (f: unknown[]) => {
  const [d, m, a] = String(f[2]).split('/');
  const dia = `${a}-${m}-${d}`;
  return [dia, new Date(Date.parse(dia + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)];
};
// La factura que Ecomm-App hizo sola para la parte cobrada con Mercado Pago (null si todavía no está).
async function facturaMP(x: NonNullable<Awaited<ReturnType<typeof fila>>>, mpPesos: number) {
  const mp = String(x.f[16] ?? '').match(/MP (\d+)/);
  if (!mp) return { pendiente: 'Todavía no se encontró el pago en Mercado Pago' };
  const cobro = Number(String(x.f[16]).match(/cobró \$(\d+)/)?.[1]) || mpPesos;
  const fa = await facturaDePagoMP(diasDe(x.f), cobro, Date.parse(String(x.f[1]).replace(' ', 'T') + ':00-03:00'), x.usadas);
  if (!fa) return { pendiente: 'Ecomm-App todavía no hizo la factura de este pago (se hace sola, probá en unos minutos)' };
  await guardar(x.celda, fa);
  return { fa };
}
const pesosMP = (f: unknown[]) => pagosDe(f).filter((p) => CON_MP.has(p.medio)).reduce((s, p) => s + p.pesos, 0);

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const nro = Number(u.searchParams.get('nro'));
    const x = nro > 0 ? await fila(nro) : null;
    if (!x) return json({ error: 'No existe ese pedido' }, 404);
    const ya = guardada(x.f);
    if (ya) return json({ factura: ya });
    const mpPesos = pesosMP(x.f);
    if (!mpPesos) return json({ factura: null, puedeFacturar: x.f[14] !== 'anulada' });
    const r = await facturaMP(x, mpPesos);
    return json(r.fa ? { factura: r.fa } : { factura: null, pendiente: r.pendiente });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const nro = Number(b.nro), documento = String(b.documento ?? '').replace(/\D/g, '');
    const email = String(b.email ?? '').trim();
    if (!cuitValido(documento)) return json({ error: 'El CUIT/CUIL no es válido (son 11 números)' }, 400);
    const x = nro > 0 ? await fila(nro) : null;
    if (!x) return json({ error: 'No existe ese pedido' }, 404);
    if (x.f[14] === 'anulada') return json({ error: 'El pedido está anulado' }, 400);
    let ya = guardada(x.f);
    const mpPesos = pesosMP(x.f);
    // Ya tiene la factura definitiva (a CUIT, o la de MP y no se pidió cambiarla)
    if (ya && (ya.origen === 'caja' || !b.cambiar)) return json({ factura: ya, yaExistia: true });
    if (mpPesos && !b.cambiar)
      return json({ error: 'Esta venta se cobró con Mercado Pago: la factura la hace sola Ecomm-App. Para factura A usá "Pasar a factura A"' }, 400);
    let reemplaza: Pick<FacturaLocal, 'reemplaza' | 'nc'> = {};
    if (mpPesos) {
      if (!ya) { const r = await facturaMP(x, mpPesos); if (!r.fa) return json({ error: r.pendiente + '. Recién ahí se puede pasar a factura A.' }, 409); ya = r.fa; }
      if (!ya.nc) { // 1) anular la B de Mercado Pago con una nota de crédito total
        const nc = await notaDeCreditoTotal({ clave: `mateando-local-nc-${nro}-${ya.numero}`, numero: ya.numero, tipo: ya.tipo, cae: ya.cae, dias: diasDe(x.f) });
        ya = { ...ya, nc };
        await guardar(x.celda, ya);
      }
      reemplaza = { reemplaza: ya.numero, nc: ya.nc };
    }
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
    const final = { ...fa, ...reemplaza }; // 2) la factura nueva al CUIT (si había una B de MP, queda anotada cuál reemplaza)
    await guardar(x.celda, final);
    return json({ factura: final, esperado: total });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
