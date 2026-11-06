import { meta, RECARGO, tokenPara } from '@/lib/anuncios';

export const maxDuration = 60;

// Rendimiento por anuncio de una cuenta (?cuenta=act_…&periodo=today|yesterday|last_7d|last_14d|last_30d|this_month).
// Gasto con el recargo de la cuenta (igual que /canales). Compras y facturación = evento de compra del píxel.
const PERIODOS = ['today', 'yesterday', 'last_7d', 'last_14d', 'last_30d', 'this_month'];
const COMPRA = ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'];

type Accion = { action_type: string; value: string };
const valorCompra = (arr?: Accion[]) => {
  for (const t of COMPRA) {
    const a = arr?.find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const cuenta = sp.get('cuenta') ?? '';
  const periodo = PERIODOS.includes(sp.get('periodo') ?? '') ? sp.get('periodo')! : 'last_7d';
  const token = tokenPara(cuenta);
  if (!cuenta || !token) return Response.json({ error: 'Elegí una cuenta' }, { status: 400 });
  const recargo = RECARGO[cuenta] ?? 1;
  try {
    // Solo anuncios con datos en el período: se piden los insights a nivel anuncio y después las miniaturas.
    const filas: Array<Record<string, unknown>> = [];
    let url: string | null =
      `${cuenta}/insights?level=ad&date_preset=${periodo}&limit=500` +
      `&fields=ad_id,ad_name,adset_name,campaign_name,spend,impressions,clicks,inline_link_clicks,ctr,inline_link_click_ctr,actions,action_values`;
    for (let i = 0; url && i < 10; i++) {
      const j = await meta(url, token);
      filas.push(...(j.data ?? []));
      url = j.paging?.next ?? null;
    }
    const ids = filas.map((f) => String(f.ad_id));
    const creativos: Record<string, { thumb?: string; estado?: string; esVideo?: boolean }> = {};
    for (let i = 0; i < ids.length; i += 50) {
      const lote = ids.slice(i, i + 50);
      // (el parámetro ?ids= quedó deprecado en v26: se filtra la lista de anuncios de la cuenta por id)
      const filtro = encodeURIComponent(JSON.stringify([{ field: 'id', operator: 'IN', value: lote }]));
      const j = await meta(
        `${cuenta}/ads?limit=50&filtering=${filtro}&fields=id,effective_status,creative.thumbnail_width(320).thumbnail_height(320){thumbnail_url,image_url,video_id}`,
        token,
      );
      type Ad = { id: string; effective_status?: string; creative?: { thumbnail_url?: string; image_url?: string; video_id?: string } };
      for (const ad of (j.data ?? []) as Ad[]) {
        creativos[ad.id] = {
          thumb: ad.creative?.thumbnail_url ?? ad.creative?.image_url,
          estado: ad.effective_status,
          esVideo: !!ad.creative?.video_id,
        };
      }
    }
    const anuncios = filas
      .map((f) => {
        const gasto = Number(f.spend ?? 0) * recargo;
        const compras = valorCompra(f.actions as Accion[]);
        const facturacion = valorCompra(f.action_values as Accion[]);
        const impresiones = Number(f.impressions ?? 0);
        const clics = Number(f.inline_link_clicks ?? f.clicks ?? 0);
        const c = creativos[String(f.ad_id)] ?? {};
        return {
          id: String(f.ad_id), nombre: String(f.ad_name ?? ''), conjunto: String(f.adset_name ?? ''), campana: String(f.campaign_name ?? ''),
          miniatura: c.thumb ?? null, estado: c.estado ?? null, video: !!c.esVideo,
          gasto, compras, facturacion, impresiones, clics,
          cpa: compras > 0 ? gasto / compras : null,
          roas: gasto > 0 ? facturacion / gasto : null,
          ctr: impresiones > 0 ? (clics / impresiones) * 100 : null,
        };
      })
      .filter((a) => a.gasto > 0);
    return Response.json({ anuncios, periodo, recargo });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
