import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';

// Gasto de Meta Ads del período (?periodo=hoy|ayer|semana|mes): la pauta de la Tienda Online (Empretienda).
// Suma todas las cuentas de META_AD_ACCOUNTS (con RECARGO por comisiones) (act_…, separadas por coma). Token: META_ACCESS_TOKEN
// (usuario de sistema "cuenta mp3", no vence). Sin eso devuelve spend null.
// Recargo por comisiones sobre lo que informa Meta: la cuenta MATEANDO2 se paga con un medio que cobra
// 8% (pedido de Agus Machado, ads manager). MATEANDO 3 MP va tal cual.
const RECARGO: Record<string, number> = { act_1439554678210755: 1.08 };

export async function GET(req: Request) {
  const token = process.env.META_ACCESS_TOKEN;
  const cuentas = (process.env.META_AD_ACCOUNTS ?? process.env.META_AD_ACCOUNT ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  if (!token || !cuentas.length) return Response.json({ spend: null, motivo: 'Falta acceso a la cuenta de Meta Ads' });
  try {
    const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
    const range = encodeURIComponent(JSON.stringify({ since: desdeAR(periodo), until: hastaAR(periodo) }));
    const gastos = await Promise.all(cuentas.map(async (cuenta) => {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${cuenta}/insights?fields=spend&time_range=${range}&access_token=${token}`,
        { cache: 'no-store' },
      );
      const j = await res.json();
      if (j.error) throw new Error(`Meta (${cuenta}): ${j.error.message}`);
      return Number(j.data?.[0]?.spend ?? 0) * (RECARGO[cuenta] ?? 1);
    }));
    return Response.json({ spend: gastos.reduce((s, g) => s + g, 0), cuentas: cuentas.length });
  } catch (e: unknown) {
    return Response.json({ spend: null, motivo: e instanceof Error ? e.message : String(e) });
  }
}
