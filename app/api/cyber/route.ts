import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { fetchOrdersInRange, isValidOrder } from '@/lib/ml';
import { PAGO, ACORDAR } from '@/lib/empretiendaOrdenes';
import cyber2025 from '@/data/cyber-2025.json';

export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// Cyber Monday: 3 días desde la medianoche AR del primer día. 2025 = 3, 4 y 5 de nov (data/cyber-2025.json, armado
// con el export del panel de Empretienda y la API de Meli). Cada venta va como [minutos desde el inicio, monto].
const INICIO_2026 = new Date('2026-11-02T03:00:00Z');
const DIAS = 3;
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

type Venta = [number, number];
const minutos = (fecha: string | number) => Math.floor((new Date(fecha).getTime() - INICIO_2026.getTime()) / 60000);
const enEvento = (m: number) => m >= 0 && m < DIAS * 1440;

// Tienda Online (sin "a acordar" = local, igual que el export de 2025): pagadas, subtotal − cupón − desc. por pago.
async function empretienda(): Promise<{ ventas: Venta[]; actualizado: string | null }> {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: EMP, range: "'emp_ventas'!A2:I", valueRenderOption: 'UNFORMATTED_VALUE' });
  const ventas: Venta[] = [];
  let ultima = '';
  for (const x of r.data.values ?? []) {
    const m = minutos(x[2]);
    if (String(x[2]) > ultima) ultima = String(x[2]);
    if (!enEvento(m) || String(x[4]) !== PAGO.pagada || String(x[3]) === ACORDAR) continue;
    ventas.push([m, Math.round(Number(x[6]) - Number(x[7] || 0) - Number(x[8] || 0))]);
  }
  return { ventas, actualizado: ultima || null };
}

// Meli: paid/confirmed, una venta por pack (igual que /api/ml/sales).
async function meli(): Promise<Venta[]> {
  const fin = new Date(Math.min(Date.now(), INICIO_2026.getTime() + DIAS * 864e5));
  if (fin <= INICIO_2026) return [];
  const packs = new Map<number, Venta>();
  for (const o of (await fetchOrdersInRange(INICIO_2026, fin)).filter(isValidOrder)) {
    const k = o.pack_id ?? o.id;
    const p = packs.get(k) ?? [minutos(o.date_created), 0];
    p[0] = Math.min(p[0], minutos(o.date_created));
    p[1] += o.total_amount || 0;
    packs.set(k, p);
  }
  return [...packs.values()].map(([m, v]) => [m, Math.round(v)]);
}

export async function GET() {
  const [e, m] = await Promise.allSettled([empretienda(), meli()]);
  const err = (x: PromiseSettledResult<unknown>) => (x.status === 'rejected' ? String(x.reason?.message ?? x.reason) : null);
  return Response.json({
    inicio2026: INICIO_2026.toISOString(),
    dias: DIAS,
    ahora: minutos(Date.now()),
    anterior: { empretienda: cyber2025.empretienda, meli: cyber2025.meli },
    actual: {
      empretienda: e.status === 'fulfilled' ? e.value.ventas : [],
      meli: m.status === 'fulfilled' ? m.value : [],
    },
    empretiendaActualizado: e.status === 'fulfilled' ? e.value.actualizado : null,
    errores: { empretienda: err(e), meli: err(m) },
  });
}
