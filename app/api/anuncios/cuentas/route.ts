import { meta, tokensDisponibles } from '@/lib/anuncios';

// Cuentas publicitarias a las que llegan los tokens del panel, con sus píxeles.
export async function GET() {
  const tokens = tokensDisponibles();
  if (!tokens.length) return Response.json({ cuentas: [], motivo: 'Falta META_ACCESS_TOKEN en Vercel' });
  const vistas = new Set<string>();
  const cuentas: Array<{ id: string; nombre: string; moneda: string; pixeles: Array<{ id: string; nombre: string }> }> = [];
  const errores: string[] = [];
  for (const token of tokens) {
    try {
      const j = await meta('me/adaccounts?fields=name,currency,account_status&limit=100', token);
      for (const c of j.data ?? []) {
        if (vistas.has(c.id) || c.account_status !== 1) continue;
        vistas.add(c.id);
        let pixeles: Array<{ id: string; nombre: string }> = [];
        try {
          const p = await meta(`${c.id}/adspixels?fields=name&limit=50`, token);
          pixeles = (p.data ?? []).map((x: { id: string; name: string }) => ({ id: x.id, nombre: x.name }));
        } catch { /* sin permiso de píxeles: se elige igual */ }
        cuentas.push({ id: c.id, nombre: c.name, moneda: c.currency, pixeles });
      }
    } catch (e) {
      errores.push(e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json({ cuentas, errores });
}
