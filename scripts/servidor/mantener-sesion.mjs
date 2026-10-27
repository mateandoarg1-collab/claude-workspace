// Mantiene viva la sesión de Empretienda del servidor y se la pasa a GitHub Actions, que es el que lee Métricas: el
// firewall de Ualá (Imperva) bloquea a Hetzner, así que desde acá no cargan las ventas, pero el panel y el login sí.
// Hace lo mismo que subir_sesion del bot de la Mac, sin dormirse. Lo corre cron cada 30 min (ver README.md).
// Además, si se cortó la cadena del lector de GitHub (ninguna corrida en curso ni en cola), la relanza.
import { execFileSync } from 'child_process';
import { chromium } from 'playwright';

const REPO = 'mateandoarg1-collab/claude-workspace';
const RASTREO = /amplitude\.com|braze\.com|d22fxaf9t8d39k\.cloudfront\.net|googletagmanager|google-analytics|analytics\.google|doubleclick|ccm\/collect/;
// datos de los rastreadores: con ellos bloqueados se acumulan y la sesión supera los 48 KB que acepta un secreto
const BASURA = /^(AMP|amp-|EXP_|ab\.storage|_gcl|topicsLastReferenceTime|lastExternalReferrer)/;

const context = await chromium.launchPersistentContext(process.env.EMPRETIENDA_PERFIL, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  timezoneId: 'America/Argentina/Buenos_Aires',
});
await context.route(RASTREO, (r) => r.abort());
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://panel.empretienda.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const logueado = await Promise.race([
  page.getByText('Gestión de ventas').first().waitFor({ timeout: 45000 }).then(() => true),
  page.waitForURL(/auth0|login/, { timeout: 45000 }).then(() => false),
]).catch(() => false);
if (!logueado) {
  await context.close();
  throw new Error('Se cerró la sesión de Empretienda del servidor: hay que iniciarla de nuevo a mano (scripts/servidor/README.md)');
}
await page.waitForTimeout(5000); // que el panel termine de renovar el token
const estado = await context.storageState();
await context.close();

estado.cookies = estado.cookies.filter((c) => c.domain.includes('empretienda'));
estado.origins = estado.origins
  .filter((o) => o.origin.includes('empretienda'))
  .map((o) => ({ ...o, localStorage: o.localStorage.filter((i) => !BASURA.test(i.name)) }));
estado._guardado = new Date().toISOString(); // el lector usa la sesión más nueva entre esta y la que renovó él
const json = JSON.stringify(estado);
const gh = (args, input) => execFileSync('gh', [...args, '-R', REPO], { input, encoding: 'utf8' });
gh(['secret', 'set', 'EMPRETIENDA_STATE'], json);
console.log(`Sesión subida a GitHub (${Math.round(json.length / 1024)} KB)`);

const activas = gh(['run', 'list', '--workflow', 'empretienda.yml', '--json', 'status', '--jq', '[.[] | select(.status != "completed")] | length']).trim();
if (activas === '0') {
  gh(['workflow', 'run', 'empretienda.yml']);
  console.log('El lector de GitHub no estaba corriendo: relanzado');
}
