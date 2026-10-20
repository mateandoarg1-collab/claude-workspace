// Autoriza a leer Google Ads con la cuenta de Google de Mateando (una sola vez).
// Usa el mismo cliente OAuth de escritorio que GA4 (~/.claude/.mateando-oauth.json, proyecto mateando-claude)
// y guarda el refresh token en ~/.claude/.mateando-gads-token.json (fuera del repo).
//
// Uso: node scripts/google-ads-auth.mjs   → abre el navegador, aceptás el permiso y listo.

import { google } from 'googleapis';
import http from 'http';
import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';

const { client_id, client_secret } = JSON.parse(readFileSync(`${homedir()}/.claude/.mateando-oauth.json`, 'utf8')).installed;
const REDIRECT = 'http://localhost:9998/callback';
const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
const url = auth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/adwords'],
});

console.log('\n👉 Abriendo el navegador para autorizar Google Ads...');
console.log('   Entrá con la cuenta de Google que tiene acceso a la cuenta de Google Ads de Mateando.\n');
exec(`open "${url}"`);

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, 'http://localhost:9998').searchParams.get('code');
  if (!code) { res.end('Sin código'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h2>✅ Listo, Google Ads autorizado. Podés cerrar esta pestaña.</h2>');
  server.close();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    console.log('⚠️  Google no devolvió refresh token. Volvé a correr el comando.');
    return;
  }
  writeFileSync(`${homedir()}/.claude/.mateando-gads-token.json`, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  console.log('✅ Autorización guardada en ~/.claude/.mateando-gads-token.json');
  console.log('   Falta el developer token y el ID de cliente de Google Ads para leer el gasto.');
}).listen(9998);

console.log('Esperando que aceptes el permiso en el navegador...');
