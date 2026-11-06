import { meta, RECARGO, tokenPara } from '@/lib/anuncios';

// CPA máximo por cuenta, con reglas automáticas de Meta (las evalúa Meta cada 30 min, sin depender del panel).
// Se crean 2 reglas por cuenta, ambas sobre anuncios, con los últimos 3 días:
//   1. CPA alto:   costo por compra > CPA máx          → pausar
//   2. Sin ventas: gastó > CPA máx y 0 compras          → pausar
// El CPA máx que pone Machado es con recargo (igual que el panel): a Meta se le pasa CPA máx / recargo.
// Los montos van en centavos de la moneda de la cuenta.
const PREFIJO = 'PANEL CPA MAX';

const nombre = (n: number, tipo: string) => `${PREFIJO} · $${n.toLocaleString('es-AR')} · ${tipo}`;

type Regla = { id: string; name: string; status: string };

async function reglasPanel(cuenta: string, token: string): Promise<Regla[]> {
  const j = await meta(`${cuenta}/adrules_library?fields=name,status&limit=200`, token);
  return ((j.data ?? []) as Regla[]).filter((r) => r.name.startsWith(PREFIJO));
}

export async function GET(req: Request) {
  const cuenta = new URL(req.url).searchParams.get('cuenta') ?? '';
  const token = tokenPara(cuenta);
  if (!cuenta || !token) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    const reglas = await reglasPanel(cuenta, token);
    const activa = reglas.find((r) => r.status === 'ENABLED');
    const m = activa?.name.match(/\$([\d.]+)/);
    return Response.json({ cpaMax: m ? Number(m[1].replace(/\./g, '')) : null, reglas });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// body: { cuenta, cpaMax } — cpaMax 0 o vacío = desactivar. { prueba: true } crea las reglas DESACTIVADAS.
export async function POST(req: Request) {
  const { cuenta, cpaMax, prueba } = (await req.json()) as { cuenta: string; cpaMax: number; prueba?: boolean };
  const token = tokenPara(cuenta);
  if (!cuenta || !token) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  try {
    for (const r of await reglasPanel(cuenta, token)) await meta(r.id, token, { method: 'DELETE' });
    const n = Math.round(Number(cpaMax) || 0);
    if (n <= 0) return Response.json({ ok: true, cpaMax: null });
    const centavos = Math.round((n / (RECARGO[cuenta] ?? 1)) * 100);
    const base = [
      { field: 'entity_type', value: 'AD', operator: 'EQUAL' },
      { field: 'time_preset', value: 'LAST_3_DAYS', operator: 'EQUAL' },
    ];
    const comun = {
      status: prueba ? 'DISABLED' : 'ENABLED',
      execution_spec: { execution_type: 'PAUSE' },
      schedule_spec: { schedule_type: 'SEMI_HOURLY' },
    };
    const creadas = [];
    creadas.push(await meta(`${cuenta}/adrules_library`, token, {
      body: {
        ...comun, name: nombre(n, 'CPA alto'),
        evaluation_spec: { evaluation_type: 'SCHEDULE', filters: [...base, { field: 'cost_per_purchase_fb', value: centavos, operator: 'GREATER_THAN' }] },
      },
    }));
    creadas.push(await meta(`${cuenta}/adrules_library`, token, {
      body: {
        ...comun, name: nombre(n, 'sin ventas'),
        evaluation_spec: {
          evaluation_type: 'SCHEDULE',
          filters: [...base, { field: 'spent', value: centavos, operator: 'GREATER_THAN' }, { field: 'purchase_fb', value: 1, operator: 'LESS_THAN' }],
        },
      },
    }));
    return Response.json({ ok: true, cpaMax: n, reglas: creadas.map((c) => c.id) });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
