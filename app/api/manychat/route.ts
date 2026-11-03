import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';

// Receptor de mensajes de ManyChat (acción "External Request" del bot de comprobantes, con "Add Full Contact Data"):
// cada mensaje que escribe un cliente queda en la pestaña "Mensajes ManyChat" de la planilla de comprobantes, para
// leerlos y sacar conclusiones en tiempo real (la API de ManyChat solo da el último mensaje, no el historial).
// El token va en el header x-mateando-token (env MANYCHAT_WEBHOOK_TOKEN): sin él no se escribe nada.

const COMPROBANTES = '1UpKb4hhNDZFrNoxH2kIIBXIWBnHStHVflHJ1RKrvXYo';
const TAB = 'Mensajes ManyChat';

type Contacto = Record<string, unknown> & { custom_fields?: unknown };

// "Add Full Contact Data" manda los custom fields como objeto {nombre: valor}; la API, como lista [{name, value}]
function campo(c: Contacto, nombre: string): string {
  const cf = c.custom_fields;
  if (Array.isArray(cf)) {
    const f = cf.find((x) => (x as { name?: string }).name === nombre) as { value?: unknown } | undefined;
    return f?.value == null ? '' : String(f.value);
  }
  if (cf && typeof cf === 'object') {
    const v = (cf as Record<string, unknown>)[nombre];
    return v == null ? '' : String(v);
  }
  return '';
}

const txt = (v: unknown) => (v == null ? '' : String(v));

export async function POST(request: Request) {
  const token = process.env.MANYCHAT_WEBHOOK_TOKEN;
  if (!token || request.headers.get('x-mateando-token') !== token) {
    return Response.json({ error: 'no autorizado' }, { status: 401 });
  }
  let c: Contacto;
  try {
    c = await request.json();
  } catch {
    return Response.json({ error: 'body inválido' }, { status: 400 });
  }
  const mensaje = txt(c.last_input_text || c.mensaje);
  const archivo = /^https?:\/\/\S+\.(jpe?g|png|pdf|webp)/i.test(mensaje) ? mensaje : '';
  const fecha = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const fila = [
    fecha,
    campo(c, 'em_orden') || txt(c.orden),
    txt(c.name || [c.first_name, c.last_name].filter(Boolean).join(' ')),
    txt(c.whatsapp_phone || c.phone || campo(c, 'whatsapp_id_plus')),
    archivo ? '(archivo)' : mensaje.slice(0, 2000),
    archivo,
    txt(c.live_chat_url),
    txt(c.id),
    txt(c.bot || c.page_id),
  ];
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    await sheets.spreadsheets.values.append({
      spreadsheetId: COMPROBANTES,
      range: `'${TAB}'!A:I`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [fila] },
    });
    return Response.json({ ok: true });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
