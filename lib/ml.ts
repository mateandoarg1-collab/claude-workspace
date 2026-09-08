// Cliente de Mercado Libre con auto-refresh.
// Las credenciales viven en variables de entorno de Vercel.
// Como Vercel es stateless, persistimos los tokens en KV/upstash si están
// configuradas; si no, usamos memoria del proceso (se pierden entre cold starts).

const ENV = {
  app_id: process.env.ML_APP_ID!,
  client_secret: process.env.ML_CLIENT_SECRET!,
  user_id: process.env.ML_USER_ID!,
  // Tokens iniciales (se actualizan en runtime via refresh)
  initial_access_token: process.env.ML_ACCESS_TOKEN!,
  initial_refresh_token: process.env.ML_REFRESH_TOKEN!,
};

// Cache en memoria del runtime (mejor que pegarle a env cada vez)
let cachedAccess: string | null = null;
let cachedRefresh: string | null = null;
let cachedExpires = 0;

async function refreshToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: ENV.app_id,
    client_secret: ENV.client_secret,
    refresh_token: refreshToken,
  });
  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`ML refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_at: Date.now() + (data.expires_in - 300) * 1000, // margen de 5 min
  };
}

export async function getAccessToken(): Promise<string> {
  // Si tenemos cache fresco, usar
  if (cachedAccess && cachedExpires > Date.now()) return cachedAccess;

  // Primera vez: usar tokens iniciales y refrescar para tener uno fresco
  const currentRefresh = cachedRefresh ?? ENV.initial_refresh_token;
  const refreshed = await refreshToken(currentRefresh);

  cachedAccess = refreshed.access_token;
  cachedRefresh = refreshed.refresh_token;
  cachedExpires = refreshed.expires_at;

  return cachedAccess;
}

export async function mlFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const url = path.startsWith('http') ? path : `https://api.mercadolibre.com${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ML API ${path}: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export const ML_USER_ID = () => ENV.user_id;

export type MLOrder = {
  id: number;
  status: string;
  date_created: string;
  total_amount: number;
  order_items: Array<{
    item: { id: string; title: string };
    quantity: number;
    unit_price: number;
  }>;
};

type MLOrderSearch = { results: MLOrder[]; paging: { total: number } };

export function isValidOrder(o: MLOrder) {
  return o.status === 'paid' || o.status === 'confirmed';
}

export function fmtTZ(d: Date) {
  return d.toISOString().replace('Z', '-00:00');
}

type ItemThumbBody = { id: string; thumbnail?: string; secure_thumbnail?: string };
type MultigetResult = { code: number; body: ItemThumbBody };

export async function fetchThumbnails(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const results = await mlFetch<MultigetResult[]>(
          `/items?ids=${chunk.join(',')}&attributes=id,thumbnail,secure_thumbnail`,
        );
        results.forEach((r) => {
          if (r.code === 200 && r.body) {
            const url = r.body.secure_thumbnail || r.body.thumbnail || '';
            map.set(r.body.id, url.replace(/^http:\/\//, 'https://'));
          }
        });
      } catch {
        // los thumbnails son "nice to have": si falla un lote, seguimos sin esas fotos
      }
    }),
  );
  return map;
}

export async function fetchOrdersInRange(from: Date, to: Date): Promise<MLOrder[]> {
  const out: MLOrder[] = [];
  let offset = 0;
  while (true) {
    const q = new URLSearchParams({
      seller: ML_USER_ID(),
      'order.date_created.from': fmtTZ(from),
      'order.date_created.to': fmtTZ(to),
      sort: 'date_desc',
      limit: '50',
      offset: String(offset),
    });
    const data = await mlFetch<MLOrderSearch>(`/orders/search?${q}`);
    out.push(...data.results);
    if (data.results.length < 50) break;
    offset += 50;
    if (offset > 5000) break; // safety
  }
  return out;
}
