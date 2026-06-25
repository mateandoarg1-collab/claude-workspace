// Protege todas las rutas excepto /login y /api/auth.
// Verifica la cookie firmada de auth.

import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'mateando-auth';
const PUBLIC_PATHS = ['/login', '/api/auth', '/_next', '/favicon.ico'];

async function verify(value: string | undefined, secret: string): Promise<boolean> {
  if (!value) return false;
  const [payload, sig] = value.split('.');
  if (!payload || !sig) return false;
  // Re-firmar y comparar (sin importar crypto en edge runtime — usamos Web Crypto)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sigHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  if (sigHex !== sig) return false;
  const exp = Number(payload);
  return !isNaN(exp) && exp > Date.now();
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';
  const value = req.cookies.get(COOKIE_NAME)?.value;
  const ok = await verify(value, secret);

  if (!ok) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
