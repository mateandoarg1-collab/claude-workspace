// Login simple por password. Compara con env var APP_PASSWORD.
// Si matchea, setea cookie firmada por 7 días.

import { cookies } from 'next/headers';
import { createHmac } from 'crypto';

const COOKIE_NAME = 'mateando-auth';

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export async function POST(req: Request) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;
  const secret = process.env.AUTH_SECRET ?? 'dev-secret-change-me';

  if (!expected || password !== expected) {
    return Response.json({ ok: false, error: 'Password incorrecta' }, { status: 401 });
  }

  const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = `${exp}`;
  const sig = sign(payload, secret);
  const value = `${payload}.${sig}`;

  const c = await cookies();
  c.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    expires: new Date(exp),
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
  return Response.json({ ok: true });
}
