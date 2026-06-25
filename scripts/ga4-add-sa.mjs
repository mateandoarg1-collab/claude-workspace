import { google } from 'googleapis';
import http from 'http';
import { exec } from 'child_process';

const CLIENT_ID = 'PLACEHOLDER';
const CLIENT_SECRET = 'PLACEHOLDER';
const REDIRECT = 'http://localhost:9999/callback';
const PROPERTY_ID = '532493151';
const SA_EMAIL = 'mateando-sa@mateando-claude.iam.gserviceaccount.com';

// Usamos credenciales de aplicación del usuario vía OAuth instalado
const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT);
const scopes = ['https://www.googleapis.com/auth/analytics.manage.users'];
const url = auth.generateAuthUrl({ access_type: 'offline', scope: scopes });

console.log('\n👉 Abrí este link en el browser:\n', url);
exec(`open "${url}"`);

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) return;
  res.end('Listo, podés cerrar esta pestaña.');
  server.close();

  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);

  const admin = google.analyticsadmin({ version: 'v1beta', auth });
  await admin.properties.accessBindings.create({
    parent: `properties/${PROPERTY_ID}`,
    requestBody: {
      user: SA_EMAIL,
      roles: ['predefinedRoles/viewer']
    }
  });
  console.log('✅ Service account agregada a GA4 como Lector');
}).listen(9999);

console.log('Esperando autenticación...');
