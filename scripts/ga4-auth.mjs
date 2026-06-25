import { google } from 'googleapis';
import http from 'http';
import { exec } from 'child_process';
import { writeFileSync } from 'fs';
import { homedir } from 'os';

const CREDS = JSON.parse((await import('fs')).readFileSync(`${homedir()}/.claude/.mateando-oauth.json`));
const { client_id, client_secret } = CREDS.installed;
const REDIRECT = 'http://localhost:9999/callback';

const auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT);
const scopes = ['https://www.googleapis.com/auth/analytics.readonly'];
const url = auth.generateAuthUrl({ access_type: 'offline', scope: scopes, prompt: 'consent' });

console.log('\n👉 Abriendo el browser para autenticarte con Google Analytics...\n');
exec(`open "${url}"`);

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, `http://localhost:9999`).searchParams.get('code');
  if (!code) { res.end('Sin código'); return; }
  res.end('<h2>✅ Autenticado. Podés cerrar esta pestaña.</h2>');
  server.close();

  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);

  // Guardar tokens
  writeFileSync(`${homedir()}/.claude/.mateando-ga4-token.json`, JSON.stringify(tokens, null, 2));
  console.log('✅ Token guardado en ~/.claude/.mateando-ga4-token.json');

  // Test GA4
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
  const r = await analyticsdata.properties.runReport({
    property: 'properties/532493151',
    requestBody: {
      dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }]
    }
  });
  const row = r.data.rows?.[0]?.metricValues;
  console.log('✅ GA4 OK — Property: mateando-compras');
  console.log('   Sesiones (7 días):', row?.[0]?.value ?? '0');
  console.log('   Usuarios activos: ', row?.[1]?.value ?? '0');
}).listen(9999);

console.log('Esperando que completes el login en el browser...');
