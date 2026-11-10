// API pública de Ecomm-App (facturación electrónica de Mateando contra ARCA). Doc: admin.ecomm-app.com/api/v3/docs.
// Token en env ECOMMAPP_TOKEN (clave "Caja local", solo permisos de comprobantes: emitir y consultar).
const BASE = 'https://admin.ecomm-app.com/api/v3/public/facturacion';

export type FacturaLocal = { numero: string; tipo: string; cae: string; vence: string; pdf: string; total: number; origen: 'mp' | 'caja'; doc?: string; nombre?: string };

export type Comprobante = {
  invoice?: { id?: number; type?: { letra?: string; description?: string }; full_number?: string; issue_date?: string; sales_channel?: string; client_reference?: string; notes?: string };
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
    const data: Comprobante[] = Array.isArray(j.data) ? j.data : [];
    out.push(...data);
    const tp = Number(j.pagination?.total_pages ?? j.meta?.total_pages ?? 0);
    if (!data.length || (tp && page >= tp) || data.length < 50) break;
  }
  return out;
}

// La factura que Ecomm-App hizo sola para un pago de Mercado Pago (canal Mercado Pago): se busca por el N° de pago en
// la referencia del comprobante; si no aparece ahí, por monto exacto entre las de Mercado Pago del día (solo si hay una).
export async function facturaDePagoMP(mpId: string, dias: string[], monto: number): Promise<FacturaLocal | null> {
  const todos = (await Promise.all(dias.map(comprobantesDelDia))).flat();
  const porRef = todos.find((c) => [c.invoice?.client_reference, c.invoice?.notes].some((x) => String(x ?? '').includes(mpId)));
  if (porRef) return aFactura(porRef, 'mp');
  const mismoMonto = todos.filter((c) => /mercado ?pago/i.test(c.invoice?.sales_channel ?? '') && Math.abs((Number(c.amounts?.total) || 0) - monto) < 1);
  return mismoMonto.length === 1 ? aFactura(mismoMonto[0], 'mp') : null;
}

export type ItemFactura = { description: string; quantity: number; unit_price: number; vat_rate_id: number; discount_percentage?: number };

// Emite una factura a un CUIT/CUIL (el padrón de ARCA resuelve nombre y condición fiscal → A o B).
// Idempotency-Key fija por pedido y documento: reintentar nunca genera dos facturas.
export async function emitirFactura(p: { clave: string; documento: string; items: ItemFactura[]; puntoVenta: number; referencia: string; notas: string; email?: string }) {
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const j = await llamar('/emitir', {
    method: 'POST',
    headers: { 'Idempotency-Key': p.clave },
    body: JSON.stringify({ document_number: p.documento, concept_id: 1, issue_date: hoy, point_of_sale: p.puntoVenta,
      client_reference: p.referencia, notes: p.notas, ...(p.email ? { email: p.email } : {}), items: p.items }),
  });
  return aFactura(j.data ?? j, 'caja', p.documento);
}

// CUIT/CUIL válido (dígito verificador).
export function cuitValido(c: string) {
  if (!/^\d{11}$/.test(c)) return false;
  const m = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = m.reduce((a, x, i) => a + x * Number(c[i]), 0);
  let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) return false;
  return v === Number(c[10]);
}
