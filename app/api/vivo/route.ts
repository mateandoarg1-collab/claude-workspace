import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { PAGO, ACORDAR } from '@/lib/empretiendaOrdenes';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Ventas en vivo (para los vivos de Instagram): todo lo que entró desde `desde` en Empretienda y Meli.
// Empretienda sale de emp_ventas (el servidor la refresca a los 7 y 37 de cada hora), incluye pendientes
// (transferencias sin tildar, MP/GoCuotas esperando pago) aparte de las cobradas. Sin «a acordar» (local).
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const METODO: Record<string, string> = { '1': 'Mercado Pago', '3': 'Local', '5': 'Transferencia', '8': 'GoCuotas' };

export type VentaVivo = { t: string; canal: 'empretienda' | 'meli'; monto: number; cobrada: boolean; medio: string; producto: string };

function primero(j: unknown) {
  try { const l = JSON.parse(String(j)); return l.map((p: { n: string; q: number }) => (p.q > 1 ? `${p.q}× ` : '') + p.n).join(' + ').slice(0, 70); } catch { return ''; }
}

async function empretienda(desde: Date, hasta: Date) {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: EMP, range: "'emp_ventas'!A2:Q", valueRenderOption: 'UNFORMATTED_VALUE' });
  const ventas: VentaVivo[] = [];
  let ultima = 0;
  for (const x of r.data.values ?? []) {
    const t = new Date(x[2]).getTime();
    if (t > ultima) ultima = t;
    const estado = String(x[4]);
    if (t < desde.getTime() || t > hasta.getTime() || String(x[3]) === ACORDAR || (estado !== PAGO.pagada && estado !== PAGO.pendiente)) continue;
    ventas.push({
      t: new Date(t).toISOString(), canal: 'empretienda',
      monto: Math.round(Number(x[6]) - Number(x[7] || 0) - Number(x[8] || 0) + Number(x[9] || 0)),
      cobrada: estado === PAGO.pagada, medio: METODO[String(x[3])] ?? 'Otro',
      producto: primero(x[16]),
    });
  }
  return { ventas, ultima: ultima ? new Date(ultima).toISOString() : null };
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('desde');
  const desde = q ? new Date(q) : new Date(Date.now() - 3600e3);
  const qh = new URL(req.url).searchParams.get('hasta');
  const hasta = qh ? new Date(qh) : new Date(8.64e15);
  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) return Response.json({ error: 'desde inválido' }, { status: 400 });
  const [e] = await Promise.allSettled([empretienda(desde, hasta)]);
  const err = (x: PromiseSettledResult<unknown>) => (x.status === 'rejected' ? String(x.reason?.message ?? x.reason) : null);
  const ventas = [...(e.status === 'fulfilled' ? e.value.ventas : []), ].sort((a, b) => b.t.localeCompare(a.t));
  return Response.json({
    desde: desde.toISOString(), ahora: new Date().toISOString(), ventas,
    empretiendaUltima: e.status === 'fulfilled' ? e.value.ultima : null,
    errores: { empretienda: err(e) },
  });
}
