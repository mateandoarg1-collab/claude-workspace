import Anthropic from '@anthropic-ai/sdk';

// "Cerebro" de la Bandeja Mateando (mateando-inbox.vercel.app, app aparte): la bandeja manda un resumen de las
// conversaciones y acá se las pasa a Claude (ANTHROPIC_API_KEY vive solo en esta app). Mismo header que el puente
// de ML: x-inbox-token = INBOX_ML_TOKEN.
//   tipo "informe"     → informe en markdown con conclusiones y consejos (Juampi, 11-nov-2026).
//   tipo "prioridades" → para cada chat pendiente: urgencia (alta/media/baja) y motivo corto.
// Refusal fallback "default" (server-side) activado por defecto, como recomienda la API para Opus 5.5.

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MODELO = 'claude-opus-5-5';

const CONTEXTO = `Mateando es una marca argentina de mates, termos, bombillas, sets materos y accesorios (Andomat 611 S.R.L).
Vende por tienda online (Empretienda), Mercado Libre, Shopify, mayorista y un local. Hace mates personalizados con grabado láser.
Atiende clientes por WhatsApp (con un bot de IA en ManyChat), un bot de comprobantes de transferencia por WhatsApp, Instagram,
Facebook Messenger, TikTok, comentarios de Instagram/Facebook y mensajes/preguntas de Mercado Libre.
Equipo: Vicky (diseñadora: coordina grabados y personalizados), Ángel (despacha y maneja la posventa de Mercado Libre),
Juampi (dueño). Los envíos van por OCA. Moneda: pesos argentinos.`;

type Chat = {
  clave: string; canal: string; area?: string; nombre: string; producto?: string; estado?: string;
  mensajes: { fecha: string; quien: string; texto: string }[];
};

function transcribir(chats: Chat[]) {
  return chats
    .map((c) => {
      const cab = [`[${c.clave}] ${c.canal}${c.area ? `/${c.area}` : ''} · ${c.nombre}`, c.producto && `producto: ${c.producto}`, c.estado && `estado: ${c.estado}`]
        .filter(Boolean).join(' · ');
      const msgs = c.mensajes.map((m) => `  ${m.fecha.slice(5, 16)} ${m.quien}: ${m.texto.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n');
      return `${cab}\n${msgs}`;
    })
    .join('\n\n');
}

async function preguntar(client: Anthropic, system: string, contenido: string, effort: 'low' | 'medium' | 'high', format?: { type: 'json_schema'; schema: Record<string, unknown> }) {
  const stream = client.beta.messages.stream({
    model: MODELO,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort, ...(format ? { format } : {}) },
    system,
    messages: [{ role: 'user', content: contenido }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error('Claude no pudo procesar este pedido (refusal).');
  return msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
}

export async function POST(req: Request) {
  const t = process.env.INBOX_ML_TOKEN;
  if (!t || req.headers.get('x-inbox-token') !== t) return Response.json({ error: 'no autorizado' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: 'Falta ANTHROPIC_API_KEY' }, { status: 500 });
  const { tipo, chats, dias } = (await req.json().catch(() => ({}))) as { tipo?: string; chats?: Chat[]; dias?: number };
  if (!Array.isArray(chats) || !chats.length) return Response.json({ error: 'No hay conversaciones para analizar' }, { status: 400 });
  const client = new Anthropic();

  try {
    if (tipo === 'informe') {
      const system = `${CONTEXTO}

Sos el analista de atención al cliente de Mateando. Te paso las conversaciones de los últimos ${dias ?? 3} días de todos los canales.
Escribí un informe en castellano rioplatense, claro y concreto, para el dueño, en markdown con estas secciones (## títulos):
## En pocas palabras (3 a 5 líneas con lo más importante)
## Lo que más preguntan (temas, con cuántas conversaciones aprox. y ejemplos cortos)
## Reclamos y problemas que se repiten
## Ventas que se están perdiendo (consultas sin responder, demoras, objeciones de precio/envío)
## Errores o respuestas flojas del bot (citá el caso y cómo debería haber respondido)
## Qué mejorar (lista priorizada: acción concreta, quién la haría, impacto esperado)
## Para hacer hoy (máximo 5 chats o tareas puntuales, con el [código] del chat)
Basate solo en lo que dicen las conversaciones; si algo no alcanza para concluir, decilo. No inventes números.`;
      const informe = await preguntar(client, system, transcribir(chats), 'high');
      return Response.json({ informe });
    }
    if (tipo === 'prioridades') {
      const system = `${CONTEXTO}

Te paso chats que esperan respuesta del equipo. Para cada uno decidí la urgencia:
- "alta": reclamo, cliente enojado, problema con un pedido pagado, o venta a punto de cerrarse (quiere comprar ya, pide link o datos de pago).
- "media": consulta de compra concreta (precio, stock, envío) o coordinación pendiente (diseño, retiro).
- "baja": saludo, agradecimiento, comentario sin pedido, o ya resuelto.
Motivo: máximo 8 palabras, en castellano. Devolvé un ítem por cada [código] recibido.`;
      const schema = {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { clave: { type: 'string' }, nivel: { type: 'string', enum: ['alta', 'media', 'baja'] }, motivo: { type: 'string' } },
              required: ['clave', 'nivel', 'motivo'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      };
      const txt = await preguntar(client, system, transcribir(chats), 'low', { type: 'json_schema', schema });
      const items = (JSON.parse(txt) as { items: { clave: string; nivel: string; motivo: string }[] }).items;
      return Response.json({ items });
    }
    return Response.json({ error: 'tipo debe ser informe o prioridades' }, { status: 400 });
  } catch (e: unknown) {
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: 'Claude está saturado, probá en un minuto' }, { status: 429 });
    if (e instanceof Anthropic.APIError) return Response.json({ error: `Claude ${e.status}: ${e.message}` }, { status: 502 });
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
