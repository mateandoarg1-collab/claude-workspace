// Google Ads (cuenta Mateando 534-660-6046) para la central de /anuncios/google.
// Auth: OAuth de mateandoarg1@gmail.com (refresh token con scope adwords) — env GOOGLE_ADS_CLIENT_ID,
// GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID. No usa developer token.
// Para crear/pausar hace falta que mateandoarg1 tenga acceso ESTÁNDAR en la cuenta (lo da mateandoads@gmail.com).

export const API = 'https://googleads.googleapis.com/v25';
export const MERCHANT_ID = '5446627486'; // Merchant Center vinculado (catálogo de la tienda)
export const LOGO_ASSET = '95180891336'; // logo cuadrado 1200×1200 ya cargado en la cuenta (BUSINESS_LOGO)
export const NOMBRE_ASSET = '234908082287'; // texto "Mateando" (nombre del negocio)
export const ARGENTINA = 'geoTargetConstants/2032';
export const ESPANOL = 'languageConstants/1003';

export const cliente = () => (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '');
export const rn = (tipo: string, id: string | number) => `customers/${cliente()}/${tipo}/${id}`;

async function token() {
  const { GOOGLE_ADS_CLIENT_ID: id, GOOGLE_ADS_CLIENT_SECRET: secret, GOOGLE_ADS_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh || !cliente()) throw new Error('Falta acceso a Google Ads');
  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }),
  }).then((r) => r.json());
  if (!tok.access_token) throw new Error(`Google: ${tok.error_description ?? tok.error}`);
  return tok.access_token as string;
}

type ErrGoogle = { error?: { message: string; details?: Array<{ errors?: Array<{ message: string; errorCode?: Record<string, string>; location?: unknown }> }> } };
function mensaje(j: ErrGoogle) {
  const errs = j.error?.details?.flatMap((d) => d.errors ?? []) ?? [];
  if (errs.some((e) => e.errorCode?.authorizationError === 'ACTION_NOT_PERMITTED')) {
    return 'mateandoarg1@gmail.com tiene solo lectura en Google Ads: Machado tiene que darle acceso Estándar';
  }
  return errs.length ? errs.map((e) => e.message).join(' · ') : j.error?.message ?? 'Error de Google Ads';
}

export async function gq<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const t = await token();
  const out: T[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const j = await fetch(`${API}/customers/${cliente()}/googleAds:search`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageToken }), cache: 'no-store',
    }).then((r) => r.json());
    if (j.error) throw new Error(mensaje(j));
    out.push(...(j.results ?? []));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

// googleAds:mutate con varias operaciones en una sola transacción (todo o nada). validar = no crea nada.
export async function gmutate(operaciones: unknown[], validar = false) {
  const t = await token();
  const j = await fetch(`${API}/customers/${cliente()}/googleAds:mutate`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mutateOperations: operaciones, validateOnly: validar }), cache: 'no-store',
  }).then((r) => r.json());
  if (j.error) throw new Error(mensaje(j));
  return j as { mutateOperationResponses?: Array<Record<string, { resourceName: string }>> };
}
