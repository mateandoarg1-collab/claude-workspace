import { google } from 'googleapis';

// Carga de anuncios (/anuncios): pedido de Agus Machado (ads manager).
// Lee creatividades de una carpeta de Drive (compartida con la service account) y arma
// en Meta una campaña CBO → conjuntos (100% imágenes o 100% videos) → anuncios. Todo se crea PAUSADO.

export const GRAPH = 'https://graph.facebook.com/v21.0';
export const PAGE_ID_DEFAULT = '432778647449503'; // Mateando
export const IG_ID_DEFAULT = '17841416378822536'; // @mateandoarg

// Recargo por comisiones sobre el gasto que informa Meta: estas cuentas se pagan con un medio
// que cobra 8% (pedido de Agus Machado). MATEANDO 3 MP va tal cual.
export const RECARGO: Record<string, number> = {
  act_1439554678210755: 1.08, // MATEANDO2
  act_750953847402633: 1.08, // MATEANDO-MANYCHAT (Mayorista)
  act_1423285683055984: 1.08, // MATEANDO - SHOPIFY
};

const lista =(s?: string) => (s ?? '').split(',').map((c) => c.trim()).filter(Boolean);

// La cuenta Mayorista usa otro token (otro Business Manager).
export function tokenPara(cuenta: string): string | undefined {
  const mayoristas = lista(process.env.META_MAYORISTA_ACCOUNTS);
  return mayoristas.includes(cuenta) ? process.env.META_MAYORISTA_TOKEN : process.env.META_ACCESS_TOKEN;
}

export function tokensDisponibles(): string[] {
  return [process.env.META_ACCESS_TOKEN, process.env.META_MAYORISTA_TOKEN].filter((t): t is string => !!t);
}

export async function meta(path: string, token: string, init?: { method?: 'GET' | 'POST'; body?: Record<string, unknown> | FormData }) {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`);
  let body: BodyInit | undefined;
  if (init?.body instanceof FormData) {
    init.body.append('access_token', token);
    body = init.body;
  } else if (init?.body) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(init.body)) p.append(k, typeof v === 'string' ? v : JSON.stringify(v));
    p.append('access_token', token);
    body = p;
  } else {
    url.searchParams.set('access_token', token);
  }
  const res = await fetch(url, { method: init?.method ?? (body ? 'POST' : 'GET'), body, cache: 'no-store' });
  const j = await res.json();
  if (j.error) throw new Error(j.error.error_user_msg || j.error.message);
  return j;
}

export function driveAuth() {
  const scopes = ['https://www.googleapis.com/auth/drive.readonly'];
  const auth = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    ? new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY), scopes })
    : new google.auth.GoogleAuth({ keyFile: '/Users/jpcipolletta/.claude/.mateando-credentials.json', scopes });
  return google.drive({ version: 'v3', auth });
}

// Acepta el link completo de la carpeta o directamente el ID.
export function idCarpeta(link: string): string {
  const m = link.match(/folders\/([\w-]+)/) || link.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : link.trim();
}

export async function descargarDrive(fileId: string): Promise<Buffer> {
  const drive = driveAuth();
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return Buffer.from(res.data as ArrayBuffer);
}
