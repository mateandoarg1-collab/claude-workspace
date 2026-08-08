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

export async function getMercadoPagoSummary(fromISO: string, toISO: string) {
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
      if (isStoreSale(p)) seen.set(p.id, p.transaction_amount);
    }

    offset += limit;
    if (offset >= data.paging.total || data.results.length < limit) break;
  }

  return { orders: seen.size, amount: Array.from(seen.values()).reduce((s, v) => s + v, 0) };
}
