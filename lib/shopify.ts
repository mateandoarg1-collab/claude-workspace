// Shopify (mateando.com): ventas pagadas del período (hoy / ayer / semana / mes).
// Usa la app "mateando-whatsapp-button" (Dev Dashboard, scope read_orders) con client credentials:
// env SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET → token de 24 h.
// Mismos pedidos que el informe VENTAS REALES (PAGADAS) de Shopify (estado de pago "Pagado"), pero el monto
// es el subtotal (productos con IVA y con descuento, sin envío) para comparar con Empretienda/ML.
// El informe muestra "ventas brutas" = (subtotal + descuentos) / 1,21.

import { desdeAR, type Periodo } from './periodo';

const SHOP = 'mateando-argentina.myshopify.com';
const API_VERSION = '2026-10';

let cached: { token: string; expires: number } | null = null;

async function getToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const r = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: (process.env.SHOPIFY_CLIENT_ID ?? '').trim(),
      client_secret: (process.env.SHOPIFY_CLIENT_SECRET ?? '').trim(),
    }),
  });
  if (!r.ok) {
    const t = (await r.text()).match(/<title>([^<]*)/)?.[1] ?? r.status;
    throw new Error(`Shopify token: ${t} (client_id "${process.env.SHOPIFY_CLIENT_ID ?? ''}")`);
  }
  const d = await r.json();
  cached = { token: d.access_token, expires: Date.now() + (d.expires_in ?? 86400) * 1000 };
  return cached.token;
}

const QUERY = `query($q: String!, $after: String) {
  orders(first: 250, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes { subtotalPriceSet { shopMoney { amount } } }
  }
}`;

export async function getShopifyVentas(periodo: Periodo = 'mes') {
  const token = await getToken();
  const hasta = periodo === 'ayer' ? ` created_at:<'${desdeAR('hoy')}T00:00:00-03:00'` : '';
  const q = `financial_status:paid created_at:>='${desdeAR(periodo)}T00:00:00-03:00'${hasta} -test:true`;
  let after: string | null = null;
  let orders = 0;
  let amount = 0;
  do {
    const r: Response = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: QUERY, variables: { q, after } }),
      cache: 'no-store',
    });
    const d: { errors?: unknown; data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { subtotalPriceSet: { shopMoney: { amount: string } } }[] } } } = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors));
    const page = d.data.orders;
    for (const o of page.nodes) {
      orders += 1;
      amount += Number(o.subtotalPriceSet.shopMoney.amount);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { orders, amount: Math.round(amount * 100) / 100 };
}
