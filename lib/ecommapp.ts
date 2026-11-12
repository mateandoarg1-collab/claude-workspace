// API pública de Ecomm-App (facturación electrónica de Mateando contra ARCA). Doc: admin.ecomm-app.com/api/v3/docs.
// Token en env ECOMMAPP_TOKEN (clave "Caja local", solo permisos de comprobantes: emitir y consultar).
const BASE = 'https://admin.ecomm-app.com/api/v3/public/facturacion';

export type NotaCredito = { numero: string; cae: string; pdf: string; total: number };
// nc: nota de crédito que anuló esta factura · reemplaza: N° de la factura anulada que esta reemplaza (factura A de un pago MP)
export type FacturaLocal = { numero: string; tipo: string; cae: string; vence: string; pdf: string; total: number; origen: 'mp' | 'caja'; doc?: string; nombre?: string; nc?: NotaCredito; reemplaza?: string };

export type Comprobante = {
  invoice?: { id?: number; type?: { letra?: string; description?: string }; full_number?: string; issue_date?: string; sales_channel?: string; client_reference?: string; notes?: string; anulado?: boolean; fecha_ultima_modificacion?: string };
  authorization?: { cae?: string; expiration_date?: string };
  customer?: { document_number?: string; first_name?: string; last_name?: string };
  amounts?: { total?: number };
  pdf?: { public_url?: string };
  cae?: string; cae_expiration_date?: string;
};

function token() {
  const t = process.env.ECOMMAPP_TOKEN?.trim();
  if (!t) throw new Error('Falta configurar Ecomm-App (ECOMMAPP_TOKEN)');
  return t;
}

export async function llamar(path: string, init: RequestInit = {}) {
  const r = await fetch(BASE + path, { ...init, headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, cache: 'no-store' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.error?.code || `Ecomm-App respondió ${r.status}`);
  return j;
}

export const aFactura = (c: Comprobante, origen: 'mp' | 'caja', doc?: string): FacturaLocal => ({
  numero: c.invoice?.full_number ?? '',
  tipo: c.invoice?.type?.description || (c.invoice?.type?.letra ? `Factura ${c.invoice.type.letra}` : 'Factura'),
  cae: c.authorization?.cae || c.cae || '',
  vence: c.authorization?.expiration_date || c.cae_expiration_date || '',
  pdf: c.pdf?.public_url ?? '',
  total: Number(c.amounts?.total) || 0,
  origen, doc,
  nombre: [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(' ') || undefined,
});

// Comprobantes de un día (YYYY-MM-DD), todas las páginas.
export async function comprobantesDelDia(dia: string): Promise<Comprobante[]> {
  const out: Comprobante[] = [];
  for (let page = 1; page <= 30; page++) {
    const q = new URLSearchParams({ date_from: dia, date_to: dia, per_page: '50', page: String(page), sort: 'fecha_desc' });
    const j = await llamar(`/comprobantes?${q}`);
    const data: Comprobante[] = Array.isArray(j.data?.items) ? j.data.items : Array.isArray(j.data) ? j.data : [];
    out.push(...data);
    const tp = Number(j.data?.pagination?.total_pages ?? j.pagination?.total_pages ?? 0);
    if (!data.length || (tp ? page >= tp : data.length < 50)) break;
  }
  return out;
}

// La factura que Ecomm-App hizo sola para un pago de Mercado Pago del local (canal "mercadopago"). Ecomm-App no guarda
// el N° de pago en el comprobante, así que se busca por monto exacto entre las del canal Mercado Pago del día de la
// venta y el siguiente, sin anular y que no estén ya tomadas por otra venta de la caja; si hay varias, la creada más
// cerca del horario de la venta.
export async function facturaDePagoMP(dias: string[], monto: number, horaVenta: number, usadas: Set<string>): Promise<FacturaLocal | null> {
  const todos = (await Promise.all(dias.map(comprobantesDelDia))).flat();
  const t = (c: Comprobante) => Date.parse(String(c.invoice?.fecha_ultima_modificacion ?? '').replace(' ', 'T') + (/[Z+]/.test(String(c.invoice?.fecha_ultima_modificacion)) ? '' : '-03:00'));
  const cand = todos.filter((c) => c.invoice?.sales_channel === 'mercadopago' && !c.invoice?.anulado && Math.abs((Number(c.amounts?.total) || 0) - monto) < 1
    && !usadas.has(c.invoice?.full_number ?? '') && /^Factura/i.test(c.invoice?.type?.description ?? 'Factura'))
    .sort((a, b) => Math.abs((t(a) || 0) - horaVenta) - Math.abs((t(b) || 0) - horaVenta));
  return cand[0] ? aFactura(cand[0], 'mp') : null;
}

export type ItemFactura = { description: string; quantity: number; unit_price: number; vat_rate_id: number; discount_percentage?: number };

// Emite una factura a un CUIT/CUIL (el padrón de ARCA resuelve nombre y condición fiscal → A o B).
// Idempotency-Key fija por pedido y documento: reintentar nunca genera dos facturas.
export async function emitirFactura(p: { clave: string; documento: string; items: ItemFactura[]; puntoVenta: number; referencia: string; notas: string; email?: string }) {
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const j = await llamar('/emitir', {
    method: 'POST',
    headers: { 'Idempotency-Key': p.clave },
    // origin facturador-agil: como el Facturador Ágil del local (método manual), así si el cliente ya existe en Ecomm-App
    // con otros datos se actualiza con los del padrón de ARCA en vez de frenar la emisión.
    body: JSON.stringify({ origin: 'facturador-agil', document_number: p.documento, concept_id: 1, issue_date: hoy, point_of_sale: p.puntoVenta,
      client_reference: p.referencia, notes: p.notas, ...(p.email ? { email: p.email } : {}), items: p.items }),
  });
  return aFactura(j.data ?? j, 'caja', p.documento);
}

// Nota de crédito TOTAL de una factura (Ecomm-App copia ítems, cliente y punto de venta de la original). Se usa para
// pasar a factura A una venta cobrada con Mercado Pago, que Ecomm-App ya facturó sola como B a consumidor final.
// La factura original se busca por número entre los comprobantes de esos días para tomar su id interno.
export async function notaDeCreditoTotal(p: { clave: string; numero: string; tipo: string; cae: string; dias: string[] }): Promise<NotaCredito> {
  const letra = String(p.tipo).match(/\b([ABCM])\b/)?.[1] ?? 'B';
  const tipoNC: Record<string, number> = { A: 3, B: 8, C: 13, M: 53 };
  const orig = (await Promise.all(p.dias.map(comprobantesDelDia))).flat().find((c) => c.invoice?.full_number === p.numero);
  if (orig?.invoice?.anulado) throw new Error(`La factura ${p.numero} ya figura anulada en Ecomm-App`);
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const j = await llamar('/emitir', {
    method: 'POST',
    headers: { 'Idempotency-Key': p.clave },
    body: JSON.stringify({ invoice_type_id: tipoNC[letra], issue_date: hoy, ...(orig?.invoice?.id ? { related_invoice_id: orig.invoice.id } : { related_invoice: { cae: p.cae } }) }),
  });
  const f = aFactura(j.data ?? j, 'caja');
  return { numero: f.numero, cae: f.cae, pdf: f.pdf, total: f.total };
}

// CUIT/CUIL válido (dígito verificador).
export function cuitValido(c: string) {
  if (!/^\d{11}$/.test(c)) return false;
  const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = m.reduce((a, x, i) => a + x * Number(c[i]), 0);
  let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) return false;
  return v === Number(c[10]);
}
