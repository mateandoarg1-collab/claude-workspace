import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Estado del tildador de comprobantes (pestaña tildador_estado, la escribe auto.py en el servidor de DonWeb en cada
// pasada): última revisión, último tildado, estado (ok / error), resumen y órdenes pendientes. Para el aviso de /canales.
export async function GET() {
  try {
    const r = await google
      .sheets({ version: 'v4', auth: getAuth() })
      .spreadsheets.values.get({ spreadsheetId: '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI', range: "'tildador_estado'!A1:B10", valueRenderOption: 'UNFORMATTED_VALUE' });
    const v = Object.fromEntries((r.data.values ?? []).map(([k, x]) => [String(k), x ?? '']));
    return Response.json({
      revision: String(v.revision ?? ''),
      ultimoTildado: String(v.ultimo_tildado ?? ''),
      estado: String(v.estado ?? ''),
      resumen: String(v.resumen ?? ''),
      pendientes: v.pendientes === '' || v.pendientes == null ? null : Number(v.pendientes),
    });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
