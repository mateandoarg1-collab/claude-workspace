import { createHash } from 'node:crypto';
import { conCache } from '@/lib/cache';
import { getChina } from '@/lib/china';
import { proyectar, UNIDADES_CAJA } from '@/lib/chinaProyeccion';

export const maxDuration = 60;

// Datos para la página de la fábrica china (mateando-factory.vercel.app): solo unidades y canales del container
// LX20260521F01. Nada de precios, plata ni márgenes. Se entra con un link privado (?k=…); acá solo está el hash de la
// clave (la clave está en ~/.claude/.mateando-proveedor). Para cambiarla: clave nueva y su sha256 acá.
const HASH = 'ba05a84e08e33739d9400f4fde485bee47136c5f32e82b0f8293f8ca3141479a';

// Pedidos que ya están hechos y todavía no llegaron: se restan de la producción sugerida.
const YA_PEDIDO: Record<string, number> = { 'Autocebante|Rosa': 1725 };
const COBERTURA = 273; // la misma que usa por defecto la página China (9 meses desde que llega)

const EN: Record<string, string> = {
  Autocebante: '500ml Autocebante', 'Termo 1 L': '1000ml Thermos', 'Termo 750': '750ml Slim Thermos', 'Mate Acero 236': '8oz Mate',
  Negro: 'Black', Rosa: 'Pink', Beige: 'Beige', Blanco: 'White',
};

const ok = (k: string | null) => !!k && createHash('sha256').update(k).digest('hex') === HASH;

async function get(req: Request) {
  if (!ok(new URL(req.url).searchParams.get('k'))) return Response.json({ error: 'not found' }, { status: 404 });
  // Si una fuente falla (MeLi a veces corta), se reintenta una vez; si sigue incompleto no se muestra (ni se cachea).
  let d = await getChina();
  if (d.errores.length) d = await getChina();
  if (d.errores.length) return Response.json({ error: 'updating' }, { status: 503 });
  const filas = d.filas.map((f) => {
    const k = `${f.producto}|${f.color}`;
    const p = proyectar(f.stock ?? 0, f.base, d.hoy, { cobertura: COBERTURA, ajustes: d.ajustes, mayoristaDia: f.mayoristaDia });
    const caja = UNIDADES_CAJA[f.producto] ?? 25;
    const pedido = YA_PEDIDO[k] ?? 0;
    const sugerido = Math.ceil(Math.max(0, p.sugerido - pedido) / caja) * caja;
    return {
      product: EN[f.producto],
      color: EN[f.color],
      colorKey: f.color.toLowerCase(),
      photo: f.foto,
      arrived: f.llegaron,
      sold: f.vendidos,
      stock: f.stock,
      perDay: Math.round((f.porDia + f.mayoristaDia) * 10) / 10,
      trend: f.tendencia,
      runsOut: p.agota,
      daysLeft: p.dias,
      channels: { meli: f.porCanal.MeLi, online: f.porCanal.Empre + f.porCanal.Shopify, store: f.porCanal.Local, wholesale: f.porCanal.Mayorista },
      alreadyOrdered: pedido,
      suggested: sugerido,
      cartons: sugerido / caja,
      perCarton: caja,
    };
  });
  // Semanas de lunes a domingo, todos los canales.
  const semanas = new Map<string, number>();
  for (const x of d.diario) {
    const f = new Date(`${x.dia}T12:00:00Z`);
    const lunes = new Date(f.getTime() - ((f.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    semanas.set(lunes, (semanas.get(lunes) ?? 0) + x.minorista + x.mayorista);
  }
  const ult30 = d.diario.slice(-30).reduce((s, x) => s + x.minorista + x.mayorista, 0);
  return Response.json({
    updated: d.generado,
    today: d.hoy,
    container: 'LX20260521F01',
    arrivedOn: '2026-09-12',
    salesSince: d.desde,
    countedOn: d.conteo,
    totals: {
      arrived: filas.reduce((s, f) => s + f.arrived, 0),
      sold: d.total,
      stock: filas.reduce((s, f) => s + (f.stock ?? 0), 0),
      perDay: Math.round(ult30 / 30),
    },
    channels: { meli: d.canales.MeLi, online: d.canales.Empre + d.canales.Shopify, store: d.canales.Local, wholesale: d.canales.Mayorista },
    weekly: [...semanas].map(([week, units]) => ({ week, units })),
    items: filas,
  });
}

export const GET = conCache(get, 600);
