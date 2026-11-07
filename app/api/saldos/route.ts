// Saldo de cada cuenta publicitaria, para el aviso de arriba del panel (que no se corte la pauta).
// - Meta prepaga (MATEANDO 3 MP): «Saldo disponible» de funding_source_details (o tope − gastado) ÷ gasto diario de
//   los últimos 7 días = días que alcanza.
// - Meta con tarjeta: no tiene saldo; avisa si la cuenta no está activa (pago rechazado, deshabilitada).
// - Google Ads: presupuesto de la cuenta (account_budget aprobado − consumido) ÷ gasto diario.
// TikTok no entra: la API da saldo 0 aunque esté gastando (se cobra con tarjeta) y no da permiso de facturación.
// Env: los mismos de /api/meta y /api/google-ads.
export const dynamic = 'force-dynamic';

const G = 'https://graph.facebook.com/v21.0';
const ESTADOS: Record<number, string> = { 2: 'deshabilitada', 3: 'pago pendiente', 7: 'en revisión', 9: 'en período de gracia', 101: 'cerrada' };

export type Saldo = {
  cuenta: string;
  tipo: 'prepaga' | 'tarjeta';
  saldo: number | null; // $ que quedan (prepaga)
  gastoDia: number; // promedio de los últimos 7 días
  dias: number | null; // cuántos días alcanza el saldo
  estado: 'ok' | 'poco' | 'agotado' | 'problema';
  detalle?: string;
};

const nivel = (saldo: number, gastoDia: number): Saldo['estado'] =>
  saldo <= Math.max(1000, gastoDia * 0.05) ? 'agotado' : gastoDia && saldo / gastoDia < 2 ? 'poco' : 'ok';

async function meta(cuenta: string, token: string, nombre?: string): Promise<Saldo> {
  const [a, ins] = await Promise.all([
    fetch(`${G}/${cuenta}?fields=name,account_status,amount_spent,spend_cap,is_prepay_account,funding_source_details{display_string}&access_token=${token}`, { cache: 'no-store' }).then((r) => r.json()),
    fetch(`${G}/${cuenta}/insights?fields=spend&date_preset=last_7d&access_token=${token}`, { cache: 'no-store' }).then((r) => r.json()),
  ]);
  if (a.error) throw new Error(`Meta ${cuenta}: ${a.error.message}`);
  const gastoDia = Number(ins.data?.[0]?.spend ?? 0) / 7;
  const base = { cuenta: nombre ?? String(a.name).trim(), gastoDia };
  if (a.account_status !== 1) return { ...base, tipo: a.is_prepay_account ? 'prepaga' : 'tarjeta', saldo: null, dias: null, estado: 'problema', detalle: ESTADOS[a.account_status] ?? `estado ${a.account_status}` };
  if (!a.is_prepay_account) return { ...base, tipo: 'tarjeta', saldo: null, dias: null, estado: 'ok' };
  // «Saldo disponible: $12.345,67 ARS»; si no viene, tope de gasto − gastado (en centavos)
  const m = String(a.funding_source_details?.display_string ?? '').match(/\$\s*([\d.]+,\d{2})/);
  const saldo = m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : (Number(a.spend_cap) - Number(a.amount_spent)) / 100;
  return { ...base, tipo: 'prepaga', saldo, dias: gastoDia ? saldo / gastoDia : null, estado: nivel(saldo, gastoDia) };
}

async function google(): Promise<Saldo | null> {
  const { GOOGLE_ADS_CLIENT_ID: id, GOOGLE_ADS_CLIENT_SECRET: secret, GOOGLE_ADS_REFRESH_TOKEN: refresh, GOOGLE_ADS_CUSTOMER_ID: cliente } = process.env;
  if (!id || !secret || !refresh || !cliente) return null;
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Google: ${tok.error_description ?? tok.error}`);
  const q = (query: string) =>
    fetch(`https://googleads.googleapis.com/v25/customers/${cliente.replace(/-/g, '')}/googleAds:search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    }).then((r) => r.json());
  const [b, c] = await Promise.all([
    q("SELECT account_budget.status, account_budget.approved_spending_limit_micros, account_budget.approved_spending_limit_type, account_budget.amount_served_micros FROM account_budget WHERE account_budget.status = 'APPROVED'"),
    q('SELECT metrics.cost_micros FROM customer WHERE segments.date DURING LAST_7_DAYS'),
  ]);
  if (b.error) throw new Error(`Google Ads: ${b.error.message}`);
  const gastoDia = (c.results ?? []).reduce((s: number, r: { metrics?: { costMicros?: string } }) => s + Number(r.metrics?.costMicros ?? 0), 0) / 1e6 / 7;
  const presupuesto = (b.results ?? []).find((r: { accountBudget?: { approvedSpendingLimitMicros?: string } }) => r.accountBudget?.approvedSpendingLimitMicros);
  // sin tope aprobado (INFINITE) = se cobra sin límite: nada que avisar
  if (!presupuesto) return { cuenta: 'Google Ads', tipo: 'tarjeta', saldo: null, gastoDia, dias: null, estado: 'ok' };
  const saldo = (Number(presupuesto.accountBudget.approvedSpendingLimitMicros) - Number(presupuesto.accountBudget.amountServedMicros ?? 0)) / 1e6;
  return { cuenta: 'Google Ads', tipo: 'prepaga', saldo, gastoDia, dias: gastoDia ? saldo / gastoDia : null, estado: nivel(saldo, gastoDia), detalle: 'presupuesto de la cuenta' };
}

export async function GET() {
  const tareas: Promise<Saldo | null>[] = [];
  const t = process.env.META_ACCESS_TOKEN;
  const lista = (s?: string) => (s ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (t) for (const c of [...lista(process.env.META_AD_ACCOUNTS ?? process.env.META_AD_ACCOUNT), ...lista(process.env.META_SHOPIFY_ACCOUNTS)]) tareas.push(meta(c, t));
  if (process.env.META_MAYORISTA_TOKEN) for (const c of lista(process.env.META_MAYORISTA_ACCOUNTS)) tareas.push(meta(c, process.env.META_MAYORISTA_TOKEN, 'MATEANDO Mayorista'));
  tareas.push(google());
  const res = await Promise.allSettled(tareas);
  const cuentas = res.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  const errores = res.flatMap((r) => (r.status === 'rejected' ? [String(r.reason?.message ?? r.reason)] : []));
  return Response.json({ cuentas, errores, ahora: new Date().toISOString() });
}
