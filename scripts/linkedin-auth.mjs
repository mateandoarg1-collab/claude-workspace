// LinkedIn: autoriza la app (productos "Share on LinkedIn" + "Sign In with OpenID Connect") para publicar
// en el perfil personal y guarda el token (dura 60 días) en ~/.claude/.linkedin (fuera del repo).
//
// Uso: node scripts/linkedin-auth.mjs <client_id>
// El Client Secret lo pide por teclado. Abre el navegador, vos aceptás, y el redirect vuelve a
// http://localhost:8765/callback (tiene que estar cargado en la app, pestaña Auth → Authorized redirect URLs).

import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { createServer } from 'http';
import { exec } from 'child_process';
import { randomBytes } from 'crypto';
import { createInterface } from 'readline/promises';

const clientId = process.argv[2];
if (!clientId) {
  console.log('Uso: node scripts/linkedin-auth.mjs <client_id>');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const secret = (await rl.question('Pegá el Client Secret de la app y apretá Enter: ')).trim();
rl.close();

const REDIRECT = 'http://localhost:8765/callback';
const state = randomBytes(12).toString('hex');
const authUrl =
  'https://www.linkedin.com/oauth/v2/authorization?' +
  new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    state,
    scope: 'openid profile email w_member_social',
  });

const code = await new Promise((resolve, reject) => {
  const srv = createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback') return res.end();
    const err = u.searchParams.get('error_description');
    if (err || u.searchParams.get('state') !== state) {
      res.end('Error: ' + (err || 'state no coincide'));
      srv.close();
      return reject(new Error(err || 'state no coincide'));
    }
    res.end('Listo, ya podés cerrar esta pestaña y volver a la terminal.');
    srv.close();
    resolve(u.searchParams.get('code'));
  }).listen(8765, () => {
    console.log('Abriendo LinkedIn en el navegador para autorizar...');
    exec(`open "${authUrl}"`);
  });
});

const tokRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: clientId,
    client_secret: secret,
  }),
});
const tok = await tokRes.json();
if (!tok.access_token) {
  console.log('❌ LinkedIn:', tok.error_description || JSON.stringify(tok));
  process.exit(1);
}

const me = await (
  await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })
).json();
const vence = new Date(Date.now() + tok.expires_in * 1000).toISOString().slice(0, 10);

writeFileSync(
  `${homedir()}/.claude/.linkedin`,
  `# LinkedIn (Share on LinkedIn). Token de 60 días: volver a correr scripts/linkedin-auth.mjs antes de que venza.\n` +
    `LINKEDIN_CLIENT_ID=${clientId}\nLINKEDIN_ACCESS_TOKEN=${tok.access_token}\n` +
    `LINKEDIN_PERSON_URN=urn:li:person:${me.sub}\nLINKEDIN_TOKEN_VENCE=${vence}\n`,
  { mode: 0o600 },
);
console.log(`✅ Token guardado en ~/.claude/.linkedin — cuenta: ${me.name} — vence ${vence}`);
