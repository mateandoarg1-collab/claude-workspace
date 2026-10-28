import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

// Gasto de Google Ads del período (?periodo=hoy|ayer|semana|mes) y las conversiones que Google atribuye (compras de la
// tienda; conversiones = columna «Conversiones» de Google Ads), cuenta Mateando 534-660-6046
// (login mateandoads@gmail.com; mateandoarg1@gmail.com tiene acceso de solo lectura). No usa developer token.
// Env: GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN (scripts/google-ads-auth.mjs),
// GOOGLE_ADS_CUSTOMER_ID. Sin eso devuelve spend null.
const API = 'https://googleads.googleapis.com/v25';

export async function GET(req: Request) {
  const { GOOGLE_ADS_CLIENT_ID: id, GOOGLE_ADS_CLIENT_SECRET: secret, GOOGLE_ADS_REFRESH_TOKEN: refresh, GOOGLE_ADS_CUSTOMER_ID: cliente } = process.env;
  if (!id || !secret || !refresh || !cliente) return Response.json({ spend: null, motivo: 'Falta acceso a Google Ads' });
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
    }).then((r) => r.json());
    if (!tok.access_token) return Response.json({ spend: null, motivo: `Google: ${tok.error_description ?? tok.error}` });
    const query = `SELECT metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date BETWEEN '${desdeAR(periodo)}' AND '${hastaAR(periodo)}'`;
    const res = await fetch(`${API}/customers/${cliente.replace(/-/g, '')}/googleAds:search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      cache: 'no-store',
    });
    const j = await res.json();
    if (j.error) return Response.json({ spend: null, motivo: `Google Ads: ${j.error.message}` });
    type Fila = { metrics?: { costMicros?: string; conversions?: number; conversionsValue?: number } };
    const sumar = (k: (r: Fila) => number) => (j.results ?? []).reduce((s: number, r: Fila) => s + k(r), 0);
    // Hoy la conversión de compra no manda el monto (vale 1 cada una): valor = conversiones. El panel lo detecta y estima.
    return Response.json({
      spend: sumar((r) => Number(r.metrics?.costMicros ?? 0)) / 1e6,
      conversiones: sumar((r) => Number(r.metrics?.conversions ?? 0)),
      valor: sumar((r) => Number(r.metrics?.conversionsValue ?? 0)),
    });
  } catch (e: unknown) {
    return Response.json({ spend: null, motivo: e instanceof Error ? e.message : String(e) });
  }
}
