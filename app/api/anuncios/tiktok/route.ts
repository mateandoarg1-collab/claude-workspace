import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Rendimiento de TikTok Ads por anuncio: lee la pestaña tiktok_anuncios, que llena cada hora el servidor
// (tiktokAnunciosAPlanilla en scripts/tienda-rentabilidad.mjs) con la API de TikTok (solo permiso de Reporting).
// ?periodo=hoy|ayer|7d|14d|30d. Montos en pesos al dólar blue del momento de la carga.
export async function GET(req: Request) {
  const periodo = new URL(req.url).searchParams.get('periodo') ?? '7d';
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI', range: "'tiktok_anuncios'!A2:L", valueRenderOption: 'UNFORMATTED_VALUE',
    });
    const filas = r.data.values ?? [];
    const anuncios = filas.filter((f) => f[0] === periodo).map((f) => {
      const gasto = Number(f[5]) || 0, compras = Number(f[6]) || 0, valor = Number(f[7]) || 0, imp = Number(f[8]) || 0, clics = Number(f[9]) || 0;
      return {
        id: String(f[1]), nombre: String(f[2]), campana: String(f[3]), conjunto: String(f[4]), gasto, compras, facturacion: valor, impresiones: imp, clics,
        cpa: compras > 0 ? gasto / compras : null, roas: gasto > 0 && valor > 0 ? valor / gasto : null, ctr: imp > 0 ? (clics / imp) * 100 : null,
      };
    });
    return Response.json({ anuncios, actualizado: filas[0]?.[10] ?? null, blue: filas[0]?.[11] ?? null });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
