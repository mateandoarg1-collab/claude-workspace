import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

// Gasto de TikTok Ads del período (?periodo=hoy|ayer|semana|mes): cuenta ANDOMAT 611 SRL
// (advertiser 7674343976610185233), app "Mateando Dashboard" del portal de desarrolladores de TikTok.
// Env: TIKTOK_ACCESS_TOKEN (long-term, no vence) y TIKTOK_ADVERTISER_ID. Sin eso devuelve spend null.
export async function GET(req: Request) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const cuenta = process.env.TIKTOK_ADVERTISER_ID;
  if (!token || !cuenta) return Response.json({ spend: null, motivo: 'Esperando que TikTok apruebe la app' });
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const q = new URLSearchParams({
      advertiser_id: cuenta,
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: JSON.stringify(['advertiser_id']),
      metrics: JSON.stringify(['spend']),
      start_date: desdeAR(periodo),
      end_date: hastaAR(periodo),
    });
    const res = await fetch(`https://business-api.tiktok.com/open_api/v1.3/report/integrated/get/?${q}`, {
      headers: { 'Access-Token': token },
      cache: 'no-store',
    });
    const j = await res.json();
    if (j.code !== 0) return Response.json({ spend: null, motivo: `TikTok: ${j.message}` });
    const spend = (j.data?.list ?? []).reduce((s: number, r: { metrics?: { spend?: string } }) => s + Number(r.metrics?.spend ?? 0), 0);
    return Response.json({ spend });
  } catch (e: unknown) {
    return Response.json({ spend: null, motivo: e instanceof Error ? e.message : String(e) });
  }
}
