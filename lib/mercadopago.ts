const TOKEN = process.env.MP_ACCESS_TOKEN!;

type Payment = { status: string; transaction_amount: number };
type Search = { results: Payment[]; paging: { total: number; limit: number; offset: number } };

export async function getMercadoPagoSummary(fromISO: string, toISO: string) {
  let offset = 0;
  const limit = 50;
  let orders = 0;
  let amount = 0;

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
      if (p.status === 'approved') {
        orders++;
        amount += p.transaction_amount;
      }
    }

    offset += limit;
    if (offset >= data.paging.total || data.results.length < limit) break;
  }

  return { orders, amount };
}
