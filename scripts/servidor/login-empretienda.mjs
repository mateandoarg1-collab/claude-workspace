// Inicio de sesión a mano en Empretienda para el lector del servidor (una vez, o cuando se cierre la sesión).
// Abre el navegador del lector en la pantalla virtual :99, que se ve y se maneja por noVNC (ver README.md).
// Termina solo cuando aparece Métricas; desde ahí el perfil queda logueado para leer-metricas.sh.
import { chromium } from 'playwright';

const context = await chromium.launchPersistentContext(process.env.EMPRETIENDA_PERFIL, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  timezoneId: 'America/Argentina/Buenos_Aires',
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('https://panel.empretienda.com/metricas', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('Esperando que inicies sesión en la ventana del servidor…');
await page.getByText('Volumen de ventas').first().waitFor({ timeout: 30 * 60000 });
console.log('Sesión iniciada: Métricas a la vista');
await page.waitForTimeout(5000);
await context.close();
