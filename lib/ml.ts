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

// MeLi dio de baja el multiget /items?ids= para esta app (403 "ResourceDeprecated", 12-nov-2026). Las publicaciones se
// piden de a una (/items/{id}?attributes=…), varias en paralelo, y se devuelven con la forma del multiget ({ code, body })
// para que el resto del código no cambie. Si una falla, queda con su código de error y body null.
export async function mlItems<T>(ids: string[], attributes?: string, paralelo = 15): Promise<Array<{ code: number; body: T }>> {
  const unicos = [...new Set(ids)];
  const q = attributes ? `?attributes=${attributes}` : '';
  const out: Array<{ code: number; body: T }> = new Array(unicos.length);
  let next = 0;
  const uno = async (id: string): Promise<{ code: number; body: T }> => {
    for (let intento = 0; ; intento++) {
      try {
        return { code: 200, body: await mlFetch<T>(`/items/${id}${q}`) };
      } catch (e) {
        const code = Number(String(e).match(/: (\d{3}) /)?.[1] ?? 500);
        if ((code === 429 || code >= 500) && intento < 4) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** intento)); // MeLi limita pedidos por minuto
          continue;
        }
        return { code, body: null as T };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(paralelo, unicos.length) }, async () => {
      while (next < unicos.length) {
        const i = next++;
        out[i] = await uno(unicos[i]);
      }
    }),
  );
  return out;
}

export const ML_USER_ID = () => ENV.user_id;

export type MLOrder = {
  id: number;
  status: string;
  date_created: string;
  total_amount: number;
  pack_id?: number | null;
  order_items: Array<{
    item: {
      id: string;
      title: string;
      variation_id?: number | null;
      variation_attributes?: Array<{ id: string; name: string; value_name: string | null }>;
    };
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
  // los thumbnails son "nice to have": si falla una publicación, seguimos sin esa foto
  const results: MultigetResult[] = await mlItems<ItemThumbBody>(ids, 'id,thumbnail,secure_thumbnail');
  results.forEach((r) => {
    if (r.code === 200 && r.body) {
      const url = r.body.secure_thumbnail || r.body.thumbnail || '';
      map.set(r.body.id, url.replace(/^http:\/\//, 'https://'));
    }
  });
  return map;
}

// Productos importados de China (container sep-2026). MeLi no expone el origen, así que se
// identifican por family_id: cada color es un user product distinto dentro de la familia.
export const CHINA_FAMILY_IDS = new Set<number>([
  6990630313309266, // Termo Autocebante Automate doble pico
  1127462538336336, // Mate Acero 236ml Térmico + Bombilla
  7376544667388880, // Set Matero Termo 1L + Mate + Bombilla
  5506649408378769, // Set Matero Termo 750cc + Mate + Bombilla
  6585242783220880, // Termo Mateando 1 Lt Pico Cebador
  3923350767025297, // Termo Mateando 750ml Pico Cebador
]);

type ItemMeta = { color: string | null; isChina: boolean };

// Color (atributo COLOR de la ficha) y origen China (por family_id) de cada publicación.
// El color se usa cuando la orden no trae variation_attributes (pasa en algunos user products).
export async function fetchItemMeta(ids: string[]): Promise<Map<string, ItemMeta>> {
  const map = new Map<string, ItemMeta>();
  // igual que los thumbnails: si falla una publicación, esas filas quedan sin color ni bandera
  const results = await mlItems<{ id: string; family_id?: number | null; attributes?: Array<{ id: string; value_name: string | null }> }>(
    ids,
    'id,family_id,attributes',
  );
  results.forEach((r) => {
    if (r.code !== 200 || !r.body) return;
    map.set(r.body.id, {
      color: r.body.attributes?.find((a) => a.id === 'COLOR')?.value_name ?? null,
      isChina: r.body.family_id != null && CHINA_FAMILY_IDS.has(r.body.family_id),
    });
  });
  return map;
}

export async function fetchOrdersInRange(from: Date, to: Date): Promise<MLOrder[]> {
  const page = (offset: number) =>
    mlFetch<MLOrderSearch>(
      `/orders/search?${new URLSearchParams({
        seller: ML_USER_ID(),
        'order.date_created.from': fmtTZ(from),
        'order.date_created.to': fmtTZ(to),
        sort: 'date_desc',
        limit: '50',
        offset: String(offset),
      })}`,
    );
  // Primera página para saber el total; el resto en paralelo de a 8 (un mes son ~50 páginas y
  // de a una se pasaba del tiempo máximo de Vercel).
  const first = await page(0);
  const offsets: number[] = [];
  for (let o = 50; o < Math.min(first.paging.total, 5050); o += 50) offsets.push(o);
  const out: MLOrder[] = [...first.results];
  for (let i = 0; i < offsets.length; i += 8) {
    const pages = await Promise.all(offsets.slice(i, i + 8).map(page));
    for (const p of pages) out.push(...p.results);
  }
  // ML corre el `to` una hora (lo toma en su horario, -04:00): «ayer» traía las ventas de 00:00 a 00:59 de hoy, que
  // también entraban en «hoy». Se recorta acá al rango pedido, y se sacan las repetidas por el corrimiento de páginas.
  const vistos = new Set<number>();
  return out.filter((o) => {
    const t = new Date(o.date_created).getTime();
    if (t < from.getTime() || t >= to.getTime() || vistos.has(o.id)) return false;
    vistos.add(o.id);
    return true;
  });
}

// Gasto de Product Ads (publicidad ML) entre dos días AR inclusive (YYYY-MM-DD).
// Incluye el día en curso (ML lo va actualizando durante el día).
const ADS_ADVERTISER_ID = 684717;
export async function fetchAdsCost(dateFrom: string, dateTo: string): Promise<number> {
  let total = 0;
  for (let offset = 0; ; offset += 50) {
    const j = await mlFetch<{ paging: { total: number }; results: Array<{ metrics?: { cost?: number } }> }>(
      `/advertising/MLA/advertisers/${ADS_ADVERTISER_ID}/product_ads/campaigns/search?limit=50&offset=${offset}&date_from=${dateFrom}&date_to=${dateTo}&metrics=cost`,
      { headers: { 'api-version': '2' } },
    );
    total += j.results.reduce((s, r) => s + (r.metrics?.cost ?? 0), 0);
    if (offset + 50 >= j.paging.total) return total;
  }
}

// Visitas a todas las publicaciones entre dos días AR inclusive (YYYY-MM-DD). La API toma date_to como el inicio
// de ese día, así que se le pasa el día siguiente.
export async function fetchVisitas(desde: string, hasta: string): Promise<number> {
  const fin = new Date(`${hasta}T12:00:00Z`);
  fin.setUTCDate(fin.getUTCDate() + 1);
  const r = await mlFetch<{ total_visits: number }>(
    `/users/${ML_USER_ID()}/items_visits?date_from=${desde}&date_to=${fin.toISOString().slice(0, 10)}`,
  );
  return r.total_visits ?? 0;
}
