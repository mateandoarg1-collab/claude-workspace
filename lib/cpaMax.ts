import { meta, RECARGO, tokenPara } from './anuncios';

// CPA máximo por cuenta (pedido de Agus Machado): si un anuncio activo supera el CPA máx en los últimos 3 días,
// se pausa solo. También se pausa si gastó más que el CPA máx sin ninguna venta.
// Las reglas automáticas de Meta NO sirven acá: no permiten condiciones de rendimiento con campañas CBO.
// El control lo dispara el servidor de DonWeb cada 30 min (POST /api/anuncios/cpa-max/control).
//
// Dónde se guarda: como etiqueta de la propia cuenta publicitaria ("PANEL CPA MAX $20000"), sin base de datos.
// Cada anuncio apagado queda con la etiqueta "Apagado por CPA" (visible en el Administrador de anuncios).
// El CPA máx es con recargo, igual que todo el panel.

const PREFIJO = 'PANEL CPA MAX $';
export const ETIQUETA_APAGADO = 'Apagado por CPA';
const COMPRA = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'];

type Label = { id: string; name: string };

async function etiquetas(cuenta: string, token: string): Promise<Label[]> {
  const j = await meta(`${cuenta}/adlabels?fields=name&limit=500`, token);
  return j.data ?? [];
}

export async function leerCpaMax(cuenta: string): Promise<number | null> {
  const token = tokenPara(cuenta)!;
  const l = (await etiquetas(cuenta, token)).find((x) => x.name.startsWith(PREFIJO));
  return l ? Number(l.name.slice(PREFIJO.length)) || null : null;
}

export async function guardarCpaMax(cuenta: string, cpaMax: number | null) {
  const token = tokenPara(cuenta)!;
  for (const l of (await etiquetas(cuenta, token)).filter((x) => x.name.startsWith(PREFIJO))) {
    await meta(l.id, token, { method: 'DELETE' });
  }
  if (cpaMax && cpaMax > 0) await meta(`${cuenta}/adlabels`, token, { body: { name: `${PREFIJO}${Math.round(cpaMax)}` } });
}

export type Apagado = { id: string; nombre: string; campana: string; miniatura: string | null; estado: string };

export async function listarApagados(cuenta: string): Promise<Apagado[]> {
  const token = tokenPara(cuenta)!;
  const l = (await etiquetas(cuenta, token)).find((x) => x.name === ETIQUETA_APAGADO);
  if (!l) return [];
  const j = await meta(
    `${cuenta}/adsbylabels?ad_label_ids=${encodeURIComponent(JSON.stringify([l.id]))}&limit=100` +
      `&fields=name,effective_status,updated_time,campaign{name},creative.thumbnail_width(160).thumbnail_height(160){thumbnail_url}`,
    token,
  );
  type Ad = { id: string; name: string; effective_status: string; campaign?: { name: string }; creative?: { thumbnail_url?: string } };
  return ((j.data ?? []) as Ad[]).map((a) => ({
    id: a.id, nombre: a.name, campana: a.campaign?.name ?? '', miniatura: a.creative?.thumbnail_url ?? null, estado: a.effective_status,
  }));
}

export type Decision = { cuenta: string; id: string; nombre: string; gasto: number; compras: number; cpa: number | null; motivo: string };

// Revisa los anuncios ACTIVOS de la cuenta (últimos 3 días) y pausa los que superan el CPA máx. dry = no pausa.
// probar = simular con otro CPA máx (siempre sin pausar).
export async function controlar(cuenta: string, dry = false, probar?: number): Promise<{ cpaMax: number | null; revisados: number; apagados: Decision[] }> {
  const token = tokenPara(cuenta)!;
  if (probar) dry = true;
  const cpaMax = probar || (await leerCpaMax(cuenta));
  if (!cpaMax) return { cpaMax: null, revisados: 0, apagados: [] };
  const recargo = RECARGO[cuenta] ?? 1;
  const filtro = encodeURIComponent(JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]));
  const filas: Array<{ ad_id: string; ad_name: string; spend: string; actions?: Array<{ action_type: string; value: string }> }> = [];
  let url: string | null = `${cuenta}/insights?level=ad&date_preset=last_3d&limit=500&filtering=${filtro}&fields=ad_id,ad_name,spend,actions`;
  for (let i = 0; url && i < 10; i++) {
    const j = await meta(url, token);
    filas.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  const apagados: Decision[] = [];
  for (const f of filas) {
    const gasto = Number(f.spend ?? 0) * recargo;
    let compras = 0;
    for (const t of COMPRA) {
      const a = f.actions?.find((x) => x.action_type === t);
      if (a) { compras = Number(a.value) || 0; break; }
    }
    const cpa = compras > 0 ? gasto / compras : null;
    const motivo =
      cpa !== null && cpa > cpaMax ? `CPA $${Math.round(cpa).toLocaleString('es-AR')} > máx $${cpaMax.toLocaleString('es-AR')}`
      : compras === 0 && gasto > cpaMax ? `Gastó $${Math.round(gasto).toLocaleString('es-AR')} sin ventas`
      : '';
    if (!motivo) continue;
    if (!dry) await meta(f.ad_id, token, { body: { status: 'PAUSED', adlabels: [{ name: ETIQUETA_APAGADO }] } });
    apagados.push({ cuenta, id: f.ad_id, nombre: f.ad_name, gasto, compras, cpa, motivo });
  }
  return { cpaMax, revisados: filas.length, apagados };
}
