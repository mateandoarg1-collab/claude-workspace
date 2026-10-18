import { desdeAR, parsePeriodo } from '@/lib/periodo';

// Gasto de Meta Ads del período (?periodo=hoy|semana|mes). Esa pauta empuja Empretienda,
// Shopify y Mayorista juntos, así que el ROAS se calcula contra la suma de esos canales.
// Necesita META_ACCESS_TOKEN y META_AD_ACCOUNT (act_…) en Vercel; sin eso devuelve spend null.
export async function GET(req: Request) {
  const token = process.env.META_ACCESS_TOKEN;
  const account = process.env.META_AD_ACCOUNT;
  if (!token || !account) return Response.json({ spend: null, motivo: 'Falta acceso a la cuenta de Meta Ads' });
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const hoy = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const range = encodeURIComponent(JSON.stringify({ since: desdeAR(periodo), until: hoy }));
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${account}/insights?fields=spend&time_range=${range}&access_token=${token}`,
      { cache: 'no-store' },
    );
    const j = await res.json();
    if (j.error) return Response.json({ spend: null, motivo: `Meta: ${j.error.message}` });
    return Response.json({ spend: Number(j.data?.[0]?.spend ?? 0) });
  } catch (e: unknown) {
    return Response.json({ spend: null, motivo: e instanceof Error ? e.message : String(e) });
  }
}
