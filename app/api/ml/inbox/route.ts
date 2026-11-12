import { mlFetch, mlItems, ML_USER_ID } from '@/lib/ml';

// Puente de Mercado Libre para la Bandeja Mateando (mateando-inbox.vercel.app, app aparte).
// El token de ML vive acá: su refresh es de un solo uso, así que si la bandeja lo refrescara por su cuenta
// rompería esta app. La bandeja llama a este endpoint con el header x-inbox-token (env INBOX_ML_TOKEN).
// GET  → conversaciones de posventa sin leer + preguntas recientes. Lee los mensajes con mark_as_read=false:
//        mirar la bandeja NO los marca como leídos en ML.
// POST → responde una pregunta ({tipo:'pregunta', id, texto}) o un mensaje de posventa ({tipo:'mensaje', id, comprador, texto}).
// Sin caché de CDN a propósito (la respuesta depende del header secreto); cache en memoria de 60 s.

export const dynamic = 'force-dynamic';

function autorizado(req: Request) {
  const t = process.env.INBOX_ML_TOKEN;
  return !!t && req.headers.get('x-inbox-token') === t;
}

type Mensaje = { fecha: string; quien: 'cliente' | 'equipo'; texto: string; archivo: string };
// Quién responde (Juampi, 10-nov-2026): lo de diseño de mates personalizados → Vicky (diseñadora);
// el resto de la posventa → Ángel (despacha y maneja ML); preguntas antes de comprar → aparte.
type Area = 'diseno' | 'general' | 'pregunta';
const RE_PRODUCTO_DISENO = /personaliz|grabad/i;
const RE_TEXTO_DISENO = /grab|dise[ñn]o|logo|nombre|inicial|dibujo|imagen|foto|tipograf|letra|c[oó]mo quedar/i;

type Conversacion = {
  id: string; tipo: 'mensaje' | 'pregunta'; area: Area; nombre: string; usuario: string; comprador: number;
  producto: string; orden: string; estado: string; sinLeer: number; ultimo: string; mensajes: Mensaje[];
};

const AR = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);

type MLMsg = {
  from: { user_id: number }; text: string; message_date: { created: string };
  message_attachments?: Array<{ filename: string }> | null;
};
type MLOrden = { id: number; status: string; buyer: { id: number; nickname: string; first_name?: string; last_name?: string }; order_items: Array<{ item: { title: string } }> };

async function conversacionPosventa(pack: string, sinLeer: number): Promise<Conversacion | null> {
  const vendedor = ML_USER_ID();
  try {
    const [msgs, orden] = await Promise.all([
      mlFetch<{ messages: MLMsg[]; conversation_status?: { status: string; substatus?: string } }>(
        `/messages/packs/${pack}/sellers/${vendedor}?tag=post_sale&mark_as_read=false&limit=30`,
      ),
      mlFetch<MLOrden>(`/orders/${pack}`).catch(async () => {
        const p = await mlFetch<{ orders: Array<{ id: number }> }>(`/packs/${pack}`);
        return mlFetch<MLOrden>(`/orders/${p.orders[0].id}`);
      }).catch(() => null),
    ]);
    const mensajes: Mensaje[] = (msgs.messages ?? [])
      .map((m) => ({
        fecha: AR(m.message_date.created),
        quien: (String(m.from.user_id) === vendedor ? 'equipo' : 'cliente') as Mensaje['quien'],
        texto: m.text ?? '',
        archivo: m.message_attachments?.length ? `(adjunto: ${m.message_attachments.map((a) => a.filename).join(', ')})` : '',
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const comprador = orden?.buyer.id ?? (msgs.messages ?? []).find((m) => String(m.from.user_id) !== vendedor)?.from.user_id ?? 0;
    const st = msgs.conversation_status;
    const area: Area = RE_PRODUCTO_DISENO.test(orden?.order_items.map((i) => i.item.title).join(' ') ?? '') ||
      mensajes.some((m) => m.quien === 'cliente' && RE_TEXTO_DISENO.test(m.texto)) ? 'diseno' : 'general';
    return {
      id: pack, tipo: 'mensaje', area,
      nombre: orden ? [orden.buyer.first_name, orden.buyer.last_name].filter(Boolean).join(' ') || orden.buyer.nickname : '',
      usuario: orden?.buyer.nickname ?? '', comprador,
      producto: orden?.order_items.map((i) => i.item.title).join(' + ') ?? '',
      orden: String(orden?.id ?? pack),
      estado: st?.status === 'blocked' ? `bloqueada (${st.substatus ?? ''})` : orden?.status ?? '',
      sinLeer, ultimo: mensajes[mensajes.length - 1]?.fecha ?? '', mensajes,
    };
  } catch {
    return null;
  }
}

type MLPregunta = { id: number; text: string; status: string; date_created: string; item_id: string; from: { id: number }; answer?: { text: string; date_created: string } | null };

async function preguntas(): Promise<Conversacion[]> {
  const r = await mlFetch<{ questions: MLPregunta[] }>(
    `/questions/search?seller_id=${ML_USER_ID()}&limit=40&sort_fields=date_created&sort_types=DESC&api_version=4`,
  );
  const ids = [...new Set(r.questions.map((q) => q.item_id))];
  const titulos = new Map<string, string>();
  const items = await mlItems<{ id: string; title: string }>(ids, 'id,title');
  items.forEach((it) => it.code === 200 && it.body && titulos.set(it.body.id, it.body.title));
  return r.questions.map((q) => {
    const mensajes: Mensaje[] = [{ fecha: AR(q.date_created), quien: 'cliente', texto: q.text, archivo: '' }];
    if (q.answer) mensajes.push({ fecha: AR(q.answer.date_created), quien: 'equipo', texto: q.answer.text, archivo: '' });
    return {
      id: String(q.id), tipo: 'pregunta', area: 'pregunta', nombre: `Pregunta de usuario ${q.from.id}`, usuario: '', comprador: q.from.id,
      producto: titulos.get(q.item_id) ?? q.item_id, orden: '', estado: q.status === 'UNANSWERED' ? 'sin responder' : 'respondida',
      sinLeer: q.status === 'UNANSWERED' ? 1 : 0, ultimo: mensajes[mensajes.length - 1].fecha, mensajes,
    };
  });
}

let cache: { hasta: number; datos: Conversacion[] } | null = null;

export async function GET(req: Request) {
  if (!autorizado(req)) return Response.json({ error: 'no autorizado' }, { status: 401 });
  if (cache && cache.hasta > Date.now() && !new URL(req.url).searchParams.has('fresco')) {
    return Response.json({ conversaciones: cache.datos });
  }
  try {
    const unread = await mlFetch<{ results: Array<{ resource: string; count: number }> }>(
      `/messages/unread?role=seller&tag=post_sale`,
    );
    const packs = unread.results.slice(0, 40).map((r) => ({ pack: r.resource.split('/')[2], n: r.count }));
    const convs: Conversacion[] = [];
    for (let i = 0; i < packs.length; i += 8) {
      const lote = await Promise.all(packs.slice(i, i + 8).map((p) => conversacionPosventa(p.pack, p.n)));
      lote.forEach((c) => c && convs.push(c));
    }
    const todo = [...convs, ...(await preguntas().catch(() => []))].sort((a, b) => b.ultimo.localeCompare(a.ultimo));
    cache = { hasta: Date.now() + 60_000, datos: todo };
    return Response.json({ conversaciones: todo });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!autorizado(req)) return Response.json({ error: 'no autorizado' }, { status: 401 });
  const { tipo, id, comprador, texto } = (await req.json().catch(() => ({}))) as { tipo?: string; id?: string; comprador?: number; texto?: string };
  if (!id || !texto?.trim()) return Response.json({ error: 'Faltan datos' }, { status: 400 });
  try {
    if (tipo === 'pregunta') {
      await mlFetch('/answers', { method: 'POST', body: JSON.stringify({ question_id: Number(id), text: texto }) });
    } else if (tipo === 'mensaje') {
      if (!comprador) return Response.json({ error: 'Falta el comprador' }, { status: 400 });
      const vendedor = ML_USER_ID();
      await mlFetch(`/messages/packs/${id}/sellers/${vendedor}?tag=post_sale`, {
        method: 'POST',
        body: JSON.stringify({ from: { user_id: Number(vendedor) }, to: { user_id: comprador }, text: texto }),
      });
    } else {
      return Response.json({ error: 'tipo debe ser pregunta o mensaje' }, { status: 400 });
    }
    cache = null;
    return Response.json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: /blocked/i.test(msg) ? 'Mercado Libre no deja escribir en esta conversación (está bloqueada, por ejemplo por orden cancelada).' : msg }, { status: 400 });
  }
}
