// Rentabilidad de las ventas internacionales (mateandoshop.com + ventas aparte cobradas por Stripe).
// Fuentes:
//  - Stripe (STRIPE_KEY, clave restringida de solo lectura): lo cobrado en USD y la comisión real de cada cobro.
//    Cobro con metadata.shopify_shop_domain = venta de la página; sin eso = venta aparte (link de pago manual).
//  - Shopify mateando-com (SHOPIFY_INTL_CLIENT_ID/SECRET, app "Claude Mateando", solo lectura): productos de cada
//    pedido. La API solo da los últimos 60 días (read_all_orders no está habilitado).
//  - Planilla de Leo Brime (envíos FedEx, pública): costo del envío en pesos. Se cruza por n° de pedido o por nombre.
//  - Costos de producto: data/internacional/costos.json (SKU maestro; lo arma data/internacional/armar_costos.py).
// La tienda no cobra envío (envío gratis), así que el envío de Leo es costo nuestro.
import costos from '@/data/internacional/costos.json';

const SHEET = '1gfrqj9p6IQ97Q8geLnjJG-KgbvJFIpL3Hx4D5M8l0J8';
const SHOP = 'mateando-com.myshopify.com';
const COSTOS = costos as Record<string, { skus: string[]; costo_ars: number | null; duda: string | null }>;

export type Venta = {
  id: string;
  fecha: string; // YYYY-MM-DD
  cliente: string;
  pais: string;
  origen: 'pagina' | 'aparte';
  pedido: string | null; // #1299
  productos: { titulo: string; cantidad: number; costo: number | null; supuesto: boolean }[];
  cobradoUsd: number;
  comisionUsd: number;
  devueltoUsd: number;
  dolar: number;
  cobradoArs: number;
  comisionArs: number;
  envioArs: number | null;
  envioRecargo: boolean;
  costoArs: number | null; // null = no sabemos qué llevó o falta el costo de algún producto
  gananciaArs: number | null;
};

export type EnvioSuelto = { fecha: string; pedido: string; cliente: string; pais: string; envioArs: number; motivo?: string };

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const dias = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86400000;

// ---------- Planilla de Leo ----------
type Envio = { fecha: string; pedido: string; cliente: string; pais: string; ars: number; recargo: boolean; usado?: boolean };

function csv(texto: string) {
  const filas: string[][] = [];
  let f: string[] = [], c = '', q = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (q) { if (ch === '"' && texto[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || f.length) { f.push(c); filas.push(f); }
  return filas;
}

async function envios(): Promise<Envio[]> {
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET}/export?format=csv`, { next: { revalidate: 1800 } });
  if (!r.ok) throw new Error(`Planilla de Leo: ${r.status}`);
  const out: Envio[] = [];
  for (const f of csv(await r.text())) {
    const m = (f[0] ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m || !f[3]) continue;
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    const cotizado = Number((f[4] ?? '').replace(/[^\d.]/g, ''));
    const final = Number(((f[5] ?? '').split('/')[0] ?? '').replace(/[^\d.]/g, '').replace(/\.$/, ''));
    const ars = final || cotizado;
    if (!ars) continue;
    out.push({
      fecha: `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`,
      pedido: (f[1] ?? '').trim(),
      cliente: (f[2] ?? '').trim(),
      pais: (f[3] ?? '').trim(),
      ars,
      recargo: /medidas|recargo/i.test(f[5] ?? '') || (!!final && !!cotizado && final > cotizado * 1.15),
    });
  }
  return out;
}

// ---------- Stripe ----------
type Cargo = {
  id: string; created: number; amount: number; amount_refunded: number; currency: string; status: string; paid: boolean;
  billing_details?: { name?: string | null; address?: { country?: string | null } | null };
  metadata: Record<string, string>;
  balance_transaction: { fee: number; exchange_rate: number | null; currency: string } | null;
};

async function cargos(desde: number): Promise<Cargo[]> {
  const key = (process.env.STRIPE_KEY ?? '').trim();
  if (!key) throw new Error('Falta STRIPE_KEY');
  const out: Cargo[] = [];
  let after = '';
  for (let i = 0; i < 30; i++) {
    const u = new URL('https://api.stripe.com/v1/charges');
    u.searchParams.set('limit', '100');
    u.searchParams.set('created[gte]', String(desde));
    u.searchParams.append('expand[]', 'data.balance_transaction');
    if (after) u.searchParams.set('starting_after', after);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) throw new Error(`Stripe: ${d.error?.message ?? r.status}`);
    out.push(...d.data);
    if (!d.has_more) break;
    after = d.data[d.data.length - 1].id;
  }
  return out.filter((c) => c.paid && c.status === 'succeeded');
}

// ---------- Shopify ----------
type Orden = { name: string; created_at: string; total_price: string; line_items: { title: string; quantity: number }[]; usada?: boolean };

async function ordenes(): Promise<Orden[]> {
  const t = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: (process.env.SHOPIFY_INTL_CLIENT_ID ?? '').trim(),
      client_secret: (process.env.SHOPIFY_INTL_CLIENT_SECRET ?? '').trim(),
    }),
    cache: 'no-store',
  });
  if (!t.ok) throw new Error(`Shopify internacional: token ${t.status}`);
  const { access_token } = await t.json();
  const r = await fetch(`https://${SHOP}/admin/api/2026-10/orders.json?status=any&limit=250&fields=name,created_at,total_price,line_items`, {
    headers: { 'X-Shopify-Access-Token': access_token },
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`Shopify internacional: ${r.status}`);
  return (await r.json()).orders;
}

// ---------- Dólar blue compra, promedio mensual ----------
async function dolares(): Promise<{ hoy: number; meses: Record<string, number> }> {
  const [hoy, hist] = await Promise.all([
    fetch('https://dolarapi.com/v1/dolares/blue', { next: { revalidate: 3600 } }).then((r) => r.json()),
    fetch('https://api.argentinadatos.com/v1/cotizaciones/dolares/blue', { next: { revalidate: 3600 } })
      .then((r) => r.json() as Promise<{ fecha: string; compra: number }[]>)
      .catch(() => []),
  ]);
  const acc = new Map<string, { s: number; n: number }>();
  for (const d of hist) {
    if (d.fecha < '2025-01-01' || !d.compra) continue;
    const m = acc.get(d.fecha.slice(0, 7)) ?? { s: 0, n: 0 };
    m.s += d.compra; m.n++;
    acc.set(d.fecha.slice(0, 7), m);
  }
  return { hoy: hoy.compra, meses: Object.fromEntries([...acc].map(([k, { s, n }]) => [k, Math.round(s / n)])) };
}

export async function internacional() {
  const [env, cs, os, dol] = await Promise.all([
    envios(),
    cargos(Date.parse('2025-03-01') / 1000),
    ordenes().catch(() => [] as Orden[]),
    dolares(),
  ]);

  const ventas: Venta[] = cs
    .filter((c) => c.currency === 'usd' || c.balance_transaction)
    .sort((a, b) => a.created - b.created)
    .map((c) => {
      const fecha = new Date(c.created * 1000 - 3 * 3600000).toISOString().slice(0, 10);
      const md = c.metadata ?? {};
      const pagina = !!md.shopify_shop_domain;
      const cliente =
        [md.billing_address_given_name, md.billing_address_family_name].filter(Boolean).join(' ') ||
        c.billing_details?.name || md.customer_email || '—';
      const pais = md.billing_address_country || c.billing_details?.address?.country || '';
      const cobradoUsd = c.amount / 100;
      const bt = c.balance_transaction;
      const comisionUsd = bt ? bt.fee / 100 / (bt.currency === 'usd' ? 1 : bt.exchange_rate ?? 1) : cobradoUsd * 0.042;
      const devueltoUsd = c.amount_refunded / 100;
      const dolar = dol.meses[fecha.slice(0, 7)] ?? dol.hoy;

      // Pedido de Shopify: mismo monto, hasta 2 días de diferencia.
      const o = pagina
        ? os.find((x) => !x.usada && Math.abs(Number(x.total_price) - cobradoUsd) < 0.01 && Math.abs(dias(x.created_at.slice(0, 10), fecha)) <= 2)
        : undefined;
      if (o) o.usada = true;
      const pedido = o?.name ?? null;

      // Envío de Leo: por n° de pedido, si no por nombre (alguna palabra del apellido/nombre) entre −5 y +30 días.
      const nombre = norm(cliente);
      const e =
        (pedido && env.find((x) => !x.usado && x.pedido === pedido.replace('#', ''))) ||
        env.find((x) => !x.usado && dias(x.fecha, fecha) >= -5 && dias(x.fecha, fecha) <= 30 && norm(x.cliente).some((w) => nombre.includes(w)));
      if (e) e.usado = true;

      const productos = (o?.line_items ?? []).map((l) => {
        const k = COSTOS[l.title.trim()];
        return { titulo: l.title.trim(), cantidad: l.quantity, costo: k?.costo_ars != null ? k.costo_ars * l.quantity : null, supuesto: !!k?.duda };
      });
      const costoArs = productos.length && productos.every((p) => p.costo != null) ? productos.reduce((s, p) => s + p.costo!, 0) : null;
      const netoUsd = cobradoUsd - devueltoUsd - comisionUsd;
      const envioArs = e?.ars ?? null;
      return {
        id: c.id, fecha, cliente, pais, origen: pagina ? 'pagina' : 'aparte', pedido, productos,
        cobradoUsd, comisionUsd, devueltoUsd, dolar,
        cobradoArs: Math.round((cobradoUsd - devueltoUsd) * dolar),
        comisionArs: Math.round(comisionUsd * dolar),
        envioArs, envioRecargo: !!e?.recargo, costoArs,
        gananciaArs: costoArs != null && envioArs != null ? Math.round(netoUsd * dolar - envioArs - costoArs) : null,
      } satisfies Venta;
    });

  // Envíos de Leo sin cobro en Stripe (ventas cobradas por otro lado, regalos, China, etc.)
  const sueltos: EnvioSuelto[] = env
    .filter((x) => !x.usado)
    .map((x) => ({
      fecha: x.fecha, pedido: x.pedido, cliente: x.cliente, pais: x.pais, envioArs: x.ars,
      // Lo que va a China son muestras para la fábrica (Tim / Claire), no ventas (Juampi, 13-nov-2026).
      motivo: /china/i.test(x.pais) ? 'Muestras para la fábrica' : undefined,
    }));

  return { ventas: ventas.reverse(), sueltos: sueltos.reverse(), dolarHoy: dol.hoy, actualizado: new Date().toISOString() };
}
