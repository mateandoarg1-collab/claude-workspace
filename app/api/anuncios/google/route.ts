import { gmutate, gq, rn } from '@/lib/googleAds';

export const maxDuration = 60;

const PERIODOS: Record<string, string> = { hoy: 'TODAY', ayer: 'YESTERDAY', '7d': 'LAST_7_DAYS', '14d': 'LAST_14_DAYS', '30d': 'LAST_30_DAYS', mes: 'THIS_MONTH' };
const TIPOS: Record<string, string> = {
  PERFORMANCE_MAX: 'Performance Max', SEARCH: 'Búsqueda', SHOPPING: 'Shopping', DEMAND_GEN: 'Demand Gen', VIDEO: 'YouTube', DISPLAY: 'Display',
};

type Fila = {
  campaign: { id: string; name: string; status: string; advertisingChannelType: string; biddingStrategyType?: string };
  campaignBudget?: { resourceName: string; amountMicros?: string };
  metrics?: { costMicros?: string; conversions?: number; clicks?: string; impressions?: string };
};

// GET ?periodo=7d → campañas no eliminadas con presupuesto diario y métricas del período.
export async function GET(req: Request) {
  const periodo = PERIODOS[new URL(req.url).searchParams.get('periodo') ?? '7d'] ?? 'LAST_7_DAYS';
  try {
    const [conMetricas, todas] = await Promise.all([
      gq<Fila>(`SELECT campaign.id, metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date DURING ${periodo} AND campaign.status != 'REMOVED'`),
      gq<Fila>(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.resource_name, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED'`),
    ]);
    const m = new Map(conMetricas.map((f) => [f.campaign.id, f.metrics ?? {}]));
    const campanas = todas.map((f) => {
      const x = m.get(f.campaign.id) ?? {};
      const gasto = Number(x.costMicros ?? 0) / 1e6, conv = Number(x.conversions ?? 0), clics = Number(x.clicks ?? 0), imp = Number(x.impressions ?? 0);
      return {
        id: f.campaign.id, nombre: f.campaign.name, estado: f.campaign.status, tipo: TIPOS[f.campaign.advertisingChannelType] ?? f.campaign.advertisingChannelType,
        presupuesto: Number(f.campaignBudget?.amountMicros ?? 0) / 1e6, budget: f.campaignBudget?.resourceName ?? '',
        gasto, conversiones: conv, cpa: conv > 0 ? gasto / conv : null, clics, ctr: imp ? (clics / imp) * 100 : null,
      };
    }).sort((a, b) => (a.estado === b.estado ? b.gasto - a.gasto : a.estado === 'ENABLED' ? -1 : 1));
    return Response.json({ campanas });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// POST { id, estado: 'ENABLED'|'PAUSED' } → prende/pausa.  POST { budget, presupuesto } → cambia el presupuesto diario.
export async function POST(req: Request) {
  const b = (await req.json()) as { id?: string; estado?: string; budget?: string; presupuesto?: number };
  try {
    if (b.id && (b.estado === 'ENABLED' || b.estado === 'PAUSED')) {
      await gmutate([{ campaignOperation: { update: { resourceName: rn('campaigns', b.id), status: b.estado }, updateMask: 'status' } }]);
    } else if (b.budget && Number(b.presupuesto) > 0) {
      await gmutate([{ campaignBudgetOperation: { update: { resourceName: b.budget, amountMicros: String(Math.round(Number(b.presupuesto)) * 1e6) }, updateMask: 'amount_micros' } }]);
    } else return Response.json({ error: 'Pedido inválido' }, { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
