// Shopify (mateando.com): ventas pagadas del período (hoy / ayer / semana / mes).
// Usa la app "mateando-whatsapp-button" (Dev Dashboard, scope read_orders) con client credentials:
// env SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET → token de 24 h.
// Mismos pedidos que el informe VENTAS REALES (PAGADAS) de Shopify (estado de pago "Pagado"), pero el monto es
// lo que pagó el cliente por los productos (subtotal: con IVA y con descuentos, sin envío) = la plata que entra,
// mismo criterio que Empretienda y ML. El informe muestra "Ventas brutas" = (subtotal + descuentos) / 1,21, que
// no es lo cobrado (decidido con Juampi, 20-oct-2026).
const brutas = (o: { subtotalPriceSet: { shopMoney: { amount: string } } }) => Number(o.subtotalPriceSet.shopMoney.amount);

import { desdeAR, type Periodo } from './periodo';
import { getCostosSku } from './sheets';

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

// Ventas de Shopify entre dos días AR inclusive (YYYY-MM-DD), mismo criterio que getShopifyVentas. Para el histórico.
export async function getShopifyVentasRango(desde: string, hasta: string) {
  const fin = new Date(`${hasta}T12:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  return ventasConsulta(`financial_status:paid created_at:>='${desde}T00:00:00-03:00' created_at:<'${fin.toISOString().slice(0, 10)}T00:00:00-03:00' -test:true`);
}

export async function getShopifyVentas(periodo: Periodo = 'mes') {
  const hasta = periodo === 'ayer' ? ` created_at:<'${desdeAR('hoy')}T00:00:00-03:00'` : '';
  const q = `financial_status:paid created_at:>='${desdeAR(periodo)}T00:00:00-03:00'${hasta} -test:true`;
  return ventasConsulta(q);
}

async function ventasConsulta(q: string) {
  const token = await getToken();
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
      amount += brutas(o);
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return { orders, amount: Math.round(amount * 100) / 100 };
}

// Pedidos pagados de Shopify por día AR desde `desde` (YYYY-MM-DD), mismo criterio que getShopifyVentas.
export async function getShopifyDiario(desde: string) {
  const token = await getToken();
  const q = `financial_status:paid created_at:>='${desde}T00:00:00-03:00' -test:true`;
  const query = `query($q: String!, $after: String) {
    orders(first: 250, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { createdAt subtotalPriceSet { shopMoney { amount } } }
    }
  }`;
  const dias = new Map<string, { ventas: number; monto: number }>();
  let after: string | null = null;
  do {
    const r: Response = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: { q, after } }),
      cache: 'no-store',
    });
    const d: { errors?: unknown; data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { createdAt: string; subtotalPriceSet: { shopMoney: { amount: string } } }[] } } } = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors));
    for (const o of d.data.orders.nodes) {
      const dia = new Date(new Date(o.createdAt).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
      const x = dias.get(dia) ?? { ventas: 0, monto: 0 };
      x.ventas += 1;
      x.monto += brutas(o);
      dias.set(dia, x);
    }
    after = d.data.orders.pageInfo.hasNextPage ? d.data.orders.pageInfo.endCursor : null;
  } while (after);
  return dias;
}

// Productos de Shopify cargados sin SKU: se reconocen por el nombre.
const SKU_POR_NOMBRE: [RegExp, string][] = [
  [/^Grabado láser/i, 'PERS-LAS-11017'],
  [/^Bombilla De Alpaca Cincelada Pico De Loro/i, 'BOMB-ALP-12016'],
];

// CMV de Shopify del período: SKU × cantidad de cada producto vendido, con el costo de la planilla Costos JP (getCostosSku).
// La app del panel solo tiene read_orders: el costo por unidad de Shopify (variant.inventoryItem) no se puede leer.
// Consulta aparte de getShopifyVentas para que, si falla, no rompa las ventas. Sin packaging de despacho.
export async function getShopifyCmv(periodo: Periodo = 'mes') {
  const [token, costos] = await Promise.all([getToken(), getCostosSku()]);
  const hasta = periodo === 'ayer' ? ` created_at:<'${desdeAR('hoy')}T00:00:00-03:00'` : '';
  const q = `financial_status:paid created_at:>='${desdeAR(periodo)}T00:00:00-03:00'${hasta} -test:true`;
  const query = `query($q: String!, $after: String) {
    orders(first: 100, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { paymentGatewayNames subtotalPriceSet { shopMoney { amount } } lineItems(first: 50) { nodes { quantity sku name } } }
    }
  }`;
  let cmv = 0;
  let montoTransf = 0;
  const sinCosto: Record<string, number> = {};
  let after: string | null = null;
  do {
    const r: Response = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: { q, after } }),
      cache: 'no-store',
    });
    const d: { errors?: unknown; data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { paymentGatewayNames: string[]; subtotalPriceSet: { shopMoney: { amount: string } }; lineItems: { nodes: { quantity: number; sku: string | null; name: string }[] } }[] } } } = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors));
    for (const o of d.data.orders.nodes) {
      // Transferencia bancaria (pago manual) no lleva IVA; Mercado Pago sí.
      if (!o.paymentGatewayNames.some((g) => /mercado ?pago/i.test(g))) montoTransf += Number(o.subtotalPriceSet.shopMoney.amount);
      for (const li of o.lineItems.nodes) {
        const sku = (li.sku ?? '').trim() || SKU_POR_NOMBRE.find(([rx]) => rx.test(li.name))?.[1] || '';
        if (costos[sku]) cmv += costos[sku] * li.quantity;
        else sinCosto[sku || '(sin SKU)'] = (sinCosto[sku || '(sin SKU)'] ?? 0) + li.quantity;
      }
    }
    after = d.data.orders.pageInfo.hasNextPage ? d.data.orders.pageInfo.endCursor : null;
  } while (after);
  return { cmv: Math.round(cmv), sinCosto: Object.values(sinCosto).reduce((a, b) => a + b, 0), skusSinCosto: sinCosto, montoTransf: Math.round(montoTransf) };
}

// Productos vendidos en pedidos pagados desde `desde` (YYYY-MM-DD): título, variante, cantidad vigente (descontando
// devoluciones) y día AR. Lo usa /china para contar las piezas importadas.
export async function getShopifyLineas(desde: string) {
  const token = await getToken();
  const q = `financial_status:paid created_at:>='${desde}T00:00:00-03:00' -test:true`;
  const query = `query($q: String!, $after: String) {
    orders(first: 100, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      nodes { createdAt lineItems(first: 50) { nodes { title variantTitle currentQuantity } } }
    }
  }`;
  const out: { dia: string; title: string; variant: string | null; cant: number }[] = [];
  let after: string | null = null;
  do {
    const r: Response = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query, variables: { q, after } }),
      cache: 'no-store',
    });
    const d: { errors?: unknown; data: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { createdAt: string; lineItems: { nodes: { title: string; variantTitle: string | null; currentQuantity: number }[] } }[] } } } = await r.json();
    if (d.errors) throw new Error(JSON.stringify(d.errors));
    for (const o of d.data.orders.nodes) {
      const dia = new Date(new Date(o.createdAt).getTime() - 3 * 3600e3).toISOString().slice(0, 10);
      for (const li of o.lineItems.nodes) if (li.currentQuantity > 0) out.push({ dia, title: li.title, variant: li.variantTitle, cant: li.currentQuantity });
    }
    after = d.data.orders.pageInfo.hasNextPage ? d.data.orders.pageInfo.endCursor : null;
  } while (after);
  return out;
}
