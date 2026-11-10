import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { getAuth } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// Manda por mail el ticket de una venta de la caja del local (mateando-local.vercel.app).
// POST {nro, email}. El ticket se arma acá con la fila de "Ventas Caja" (no con lo que manda la página), así el
// endpoint no sirve para mandar cualquier cosa. Sale por el Gmail de Mateando (SMTP con contraseña de aplicación,
// env GMAIL_USER y GMAIL_APP_PASSWORD en Vercel; remitente GMAIL_FROM = info@mateando.com). Guarda el mail del cliente en la columna S de la venta.
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app', 'access-control-allow-methods': 'POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
const ID = '1Gy8M6ccHZr-BX86bC2CHW5M2Ryzz8LX7EmHaZvX57wc';
const HOJA = 'Ventas Caja';
const MONEDA: Record<string, string> = { USD: 'US$', EUR: '€' };
const plata = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const e = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: CORS });

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

type Item = { nombre: string; cant: number; precio: number };
type Pago = { medio: string; pesos: number; monto?: number; cotiz?: number };

function ticket(f: unknown[]) {
  const [nro, , dia, hora, cajera, medio, sub, dTransf, pct, d, total, , , com] = f;
  let items: Item[] = []; try { items = JSON.parse(String(f[15] || '[]')); } catch {}
  let pagos: Pago[] = []; try { pagos = JSON.parse(String(f[17] || '[]')); } catch {}
  const fila = (a: string, b: string, estilo = '') => `<tr><td style="padding:3px 0;${estilo}">${a}</td><td style="padding:3px 0;text-align:right;white-space:nowrap;${estilo}">${b}</td></tr>`;
  const extra = Number(sub) - Number(dTransf || 0) - Number(total);
  const pagoTxt = pagos.length > 1 || MONEDA[pagos[0]?.medio]
    ? pagos.map((p) => fila(e(p.medio) + (MONEDA[p.medio] ? ` ${MONEDA[p.medio]} ${p.monto} (a $${p.cotiz})` : ''), plata(p.pesos))).join('')
    : fila('Medio de pago', e(medio));
  return `<!doctype html><html><body style="margin:0;background:#f3f1ec;font-family:Arial,Helvetica,sans-serif;color:#111">
  <div style="max-width:420px;margin:0 auto;padding:24px 12px">
  <div style="background:#fff;border-radius:14px;padding:24px 22px">
    <div style="text-align:center"><img src="https://mateando-local.vercel.app/logo-ticket.jpg" alt="Mateando" width="200" style="display:block;margin:0 auto 8px;max-width:200px">
      <div style="font-size:13px;color:#555;line-height:1.5">www.mateandoarg.com<br>Local Costa Rica 5651 (Palermo Hollywood)</div></div>
    <hr style="border:0;border-top:1px dashed #bbb;margin:16px 0">
    <table width="100%" style="font-size:14px;border-collapse:collapse">${fila(`<b>Pedido N° ${e(nro)}</b>`, `${e(dia)} ${e(hora)}`)}${fila('Atendió', e(cajera))}</table>
    <hr style="border:0;border-top:1px dashed #bbb;margin:12px 0">
    <table width="100%" style="font-size:14px;border-collapse:collapse">
      ${items.map((i) => fila(`${i.cant} × ${e(i.nombre.replace(/ \[LOCAL\]/, ''))}`, plata(i.precio * i.cant))).join('')}
    </table>
    <hr style="border:0;border-top:1px dashed #bbb;margin:12px 0">
    <table width="100%" style="font-size:14px;border-collapse:collapse">
      ${fila('Subtotal', plata(Number(sub) || Number(total)))}
      ${Number(dTransf) ? fila(`Desc. ${e(pct)}% ${e(String(medio).toLowerCase())}`, '−' + plata(Number(dTransf))) : ''}
      ${Number(d) && extra > 0 ? fila(`Desc. extra ${e(d)}%`, '−' + plata(extra)) : ''}
      ${fila('<b>TOTAL</b>', `<b>${plata(Number(total))}</b>`, 'font-size:18px;padding-top:6px')}
      ${pagoTxt}
    </table>
    ${com ? `<p style="font-size:13px;color:#555;margin:12px 0 0">${e(com)}</p>` : ''}
    <hr style="border:0;border-top:1px dashed #bbb;margin:16px 0">
    <div style="text-align:center;font-size:13px;line-height:1.6"><b>NO VÁLIDO COMO FACTURA</b><br>¡Gracias por tu compra!<br><a href="https://www.instagram.com/mateando" style="color:#111">@mateando</a></div>
  </div></div></body></html>`;
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const nro = Number(b.nro), email = String(b.email ?? '').trim().toLowerCase();
    if (!(nro > 0)) return json({ error: 'Falta el número de pedido' }, 400);
    if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(email) || email.length > 120) return json({ error: 'El mail no es válido' }, 400);
    const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
    if (!user || !pass) return json({ error: 'Falta configurar el mail de envío' }, 500);
    const desde = process.env.GMAIL_FROM || user; // info@mateando.com: tiene que estar como "Enviar como" en esa cuenta de Gmail
    const s = google.sheets({ version: 'v4', auth: getAuth() });
    const filas = (await s.spreadsheets.values.get({ spreadsheetId: ID, range: `'${HOJA}'!A2:S`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values ?? [];
    const i = filas.findIndex((f) => Number(f[0]) === nro);
    if (i < 0) return json({ error: `No existe el pedido N° ${nro}` }, 404);
    const f = filas[i];
    if (f[14] === 'anulada') return json({ error: 'El pedido está anulado' }, 400);
    const enviados = String(f[18] ?? '').split(', ').filter(Boolean);
    if (enviados.length >= 5) return json({ error: 'Ya se mandó muchas veces este ticket' }, 429);
    await nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } }).sendMail({
      from: `Mateando <${desde}>`, replyTo: desde, to: email, subject: `Tu compra en Mateando · Pedido N° ${nro}`, html: ticket(f),
      text: `Gracias por tu compra en Mateando (Local Costa Rica 5651). Pedido N° ${nro} · Total ${plata(Number(f[10]))}. No válido como factura.`,
    });
    if (!enviados.includes(email)) enviados.push(email);
    await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${HOJA}'!S${i + 2}`, valueInputOption: 'RAW', requestBody: { values: [[enviados.join(', ')]] } });
    return json({ ok: true });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
