const TOKEN = process.env.MP_ACCESS_TOKEN!;

type Payment = {
  id: number;
  status: string;
  transaction_amount: number;
  operation_type: string;
  point_of_interaction?: { type?: string };
  external_reference?: string;
};
type Search = { results: Payment[]; paging: { total: number; limit: number; offset: number } };

// Solo ventas reales de Empretienda: pagos de checkout (no transferencias sueltas
// tipo money_transfer/PSP_TRANSFER) y con la referencia "order-*" que usa Empretienda
// — la misma cuenta de MP también liquida ventas de Mercado Libre, que llevan otro
// formato de referencia y ya se cuentan aparte vía la API de ML.
function isStoreSale(p: Payment) {
  return (
    p.status === 'approved' &&
    p.operation_type === 'regular_payment' &&
    p.point_of_interaction?.type === 'CHECKOUT' &&
    !!p.external_reference?.startsWith('order-')
  );
}

export function getMercadoPagoSummary(fromISO: string, toISO: string) {
  return summarize(fromISO, toISO, isStoreSale);
}

// Cobros del local: Point (posnet, incluye Point Tap) y QR del local (INSTORE).
// Se piden filtrados del lado de MP: el escaneo completo paginado pierde pagos (el orden
// entre páginas no es estable), y a veces MP devuelve 0 resultados de golpe → reintento.
export async function getMercadoPagoLocalSummary(fromISO: string, toISO: string) {
  const [point, qr] = await Promise.all([
    filtered(fromISO, toISO, { operation_type: 'pos_payment' }),
    filtered(fromISO, toISO, { 'point_of_interaction.type': 'INSTORE' }),
  ]);
  const all = new Map([...point, ...qr]);
  return { orders: all.size, amount: Array.from(all.values()).reduce((s, v) => s + v, 0) };
}

async function filtered(fromISO: string, toISO: string, filter: Record<string, string>) {
  for (let intento = 0; intento < 3; intento++) {
    const seen = new Map<number, number>();
    let offset = 0;
    let total = 0;
    while (true) {
      const params = new URLSearchParams({
        range: 'date_created',
        begin_date: fromISO,
        end_date: toISO,
        sort: 'date_created',
        criteria: 'asc',
        status: 'approved',
        limit: '100',
        offset: String(offset),
        ...filter,
      });
      const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`MP API: ${res.status} ${await res.text()}`);
      const data = (await res.json()) as Search;
      // A veces MP informa total 0 aunque devuelve resultados: se pagina hasta que una página venga incompleta.
      total = Math.max(data.paging.total, offset + data.results.length);
      for (const p of data.results) seen.set(p.id, p.transaction_amount);
      offset += 100;
      if (data.results.length < 100) break;
    }
    if (total > 0) return seen;
  }
  return new Map<number, number>();
}

async function summarize(fromISO: string, toISO: string, filter: (p: Payment) => boolean) {
  let offset = 0;
  const limit = 500;
  const seen = new Map<number, number>();

  while (true) {
    const params = new URLSearchParams({
      range: 'date_approved',
      begin_date: fromISO,
      end_date: toISO,
      sort: 'date_approved',
      criteria: 'desc',
      limit: String(limit),
      offset: String(offset),
    });
    const res = await fetch(`https://api.mercadopago.com/v1/payments/search?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`MP API: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as Search;

    for (const p of data.results) {
      if (filter(p)) seen.set(p.id, p.transaction_amount);
    }

    offset += limit;
    if (offset >= data.paging.total || data.results.length < limit) break;
  }

  return { orders: seen.size, amount: Array.from(seen.values()).reduce((s, v) => s + v, 0) };
}
