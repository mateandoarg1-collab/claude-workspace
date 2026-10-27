// Vencimientos de «Mateando Datos»: los mails que Francisco manda lunes y jueves a jpcipolletta@mateando.com con
// e-Cheqs, préstamos, tarjeta, planes AFIP/AGIP y cuánto transferir desde Mercado Pago. scripts/vencimientos.py (en el
// servidor de DonWeb) los junta en la pestaña `vencimientos` de la planilla Egresos MP; acá se leen para /vencimientos.
import { google } from 'googleapis';
import { getAuth } from './sheets';

const SPREADSHEET_ID = '1PST8KAomncOqwNMLM5C3vqSjRDxEViQX0o4fr_6YAVU'; // Egresos MP

// impago: el último mail lo da por vencido e impago (el banco debita) · sin_presentar: e-Cheq vencido que el
// proveedor todavía no cobró · pagado: cheque depositado/presentado · pasado: ya venció y el último mail no lo nombra.
export type Estado = 'impago' | 'sin_presentar' | 'hoy' | 'proximo' | 'pagado' | 'pasado';
export type Vencimiento = { fecha: string; tipo: string; detalle: string; cuenta: string; monto: number; usd: number | null; estado: Estado };
export type Transferencia = { fecha: string; cuenta: string; monto: number; detalle: string };
export type Recordatorio = { fecha: string; detalle: string };

export async function getVencimientos() {
  const res = await google
    .sheets({ version: 'v4', auth: getAuth() })
    .spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'vencimientos'!A1:K", valueRenderOption: 'UNFORMATTED_VALUE' });
  const [enc = [], ...filas] = res.data.values ?? [];
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const vencimientos: Vencimiento[] = [];
  const transferencias: Transferencia[] = [];
  const recordatorios: Recordatorio[] = [];
  let ultimoMail = '';
  for (const r of filas) {
    const [clase, fecha, tipo, detalle, cuenta, monto, usd, seccion, mail, enUltimo] = r.map((c) => (typeof c === 'string' ? c.trim() : c));
    if (mail > ultimoMail) ultimoMail = String(mail);
    if (clase === 'transferencia') {
      transferencias.push({ fecha, cuenta, monto: Number(monto) || 0, detalle });
    } else if (clase === 'recordatorio') {
      recordatorios.push({ fecha, detalle });
    } else if (clase === 'obligacion') {
      const ultimo = enUltimo === true || enUltimo === 'TRUE';
      const c = String(cuenta).toUpperCase();
      const s = String(seccion).toUpperCase();
      const estado: Estado =
        c === 'DEPOSITADO' || c === 'PRESENTADO' ? 'pagado'
        : ultimo && s.startsWith('VENCIDOS E IMPAGOS') ? 'impago'
        : ultimo && s.startsWith('VENCIDOS SIN PRESENTAR') ? 'sin_presentar'
        : fecha === hoy ? 'hoy'
        : fecha > hoy ? 'proximo'
        : 'pasado';
      vencimientos.push({ fecha, tipo, detalle, cuenta, monto: Number(monto) || 0, usd: usd === '' ? null : Number(usd), estado });
    }
  }
  return { actualizado: String(enc[10] ?? ''), ultimoMail, hoy, vencimientos, transferencias, recordatorios };
}
