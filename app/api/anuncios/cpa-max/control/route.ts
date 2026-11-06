import { meta, tokensDisponibles } from '@/lib/anuncios';
import { controlar } from '@/lib/cpaMax';

export const maxDuration = 120;

// Control del CPA máximo en TODAS las cuentas que tengan uno configurado. Lo llama el servidor de DonWeb
// cada 30 min (/etc/cron.d/mateando). ?dry=1 = solo muestra qué apagaría.
export async function POST(req: Request) {
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const cuentas = new Set<string>();
  for (const t of tokensDisponibles()) {
    const j = await meta('me/adaccounts?fields=account_status&limit=100', t);
    for (const c of j.data ?? []) if (c.account_status === 1) cuentas.add(c.id);
  }
  const resultado = [];
  for (const c of cuentas) {
    try {
      const r = await controlar(c, dry);
      if (r.cpaMax) resultado.push({ cuenta: c, ...r });
    } catch (e) {
      resultado.push({ cuenta: c, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return Response.json({ dry, fecha: new Date().toISOString(), resultado });
}
