import { google } from 'googleapis';
import { desdeAR, hastaAR, parsePeriodo } from '@/lib/periodo';
import { getAuth } from '@/lib/sheets';

// Gasto de TikTok Ads del período (?periodo=hoy|ayer|semana|mes): cuenta ANDOMAT 611 SRL
// (advertiser 7674343976610185233), app "Mateando Dashboard" del portal de desarrolladores de TikTok.
// Env: TIKTOK_ACCESS_TOKEN (long-term, no vence) y TIKTOK_ADVERTISER_ID.
// Mientras la app no esté aprobada (sin env): gasto diario de la pestaña tiktok_gasto, que llena una tarea diaria
// desde Escalafy (scripts/tiktok-gasto-a-planilla.mjs).
async function desdeEscalafy(desde: string, hasta: string) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values
    .get({ spreadsheetId: '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI', range: "'tiktok_gasto'!A2:C", valueRenderOption: 'UNFORMATTED_VALUE' })
    .catch(() => null);
  const filas = r?.data.values ?? [];
  if (!filas.length) return { spend: null, motivo: 'Esperando los primeros datos de TikTok desde Escalafy' };
  const ult = filas.reduce((m, f) => (String(f[0]) > m ? String(f[0]) : m), '');
  const spend = filas.filter((f) => String(f[0]) >= desde && String(f[0]) <= hasta).reduce((s, f) => s + (Number(f[1]) || 0), 0);
  return { spend, fuente: `Escalafy (datos hasta ${ult})` };
}

export async function GET(req: Request) {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const cuenta = process.env.TIKTOK_ADVERTISER_ID;
  const periodo = parsePeriodo(new URL(req.url).searchParams.get('periodo'));
  if (!token || !cuenta) return Response.json(await desdeEscalafy(desdeAR(periodo), hastaAR(periodo)));
  try {
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
