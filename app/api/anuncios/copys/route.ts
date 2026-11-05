export const maxDuration = 60;

// Genera variantes de copy a partir de la idea de Machado, con Claude (ANTHROPIC_API_KEY en Vercel).
export async function POST(req: Request) {
  const { idea, cantidad, tipo } = (await req.json()) as { idea: string; cantidad: number; tipo?: string };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'Falta ANTHROPIC_API_KEY en Vercel' }, { status: 500 });
  if (!idea?.trim()) return Response.json({ error: 'Escribí la idea del copy' }, { status: 400 });
  const n = Math.min(Math.max(Number(cantidad) || 3, 1), 20);
  const prompt = `Sos redactor de anuncios de Meta Ads para MATEANDO (mates, termos y bombillas, Argentina, www.mateandoarg.com).
Escribí ${n} variantes DISTINTAS de copy para anuncios${tipo ? ` de ${tipo}` : ''} basadas en esta idea:

"""${idea}"""

Reglas: español rioplatense (vos), cercano, sin promesas que no estén en la idea. Variá el ángulo y el gancho de cada una (beneficio, emoción, urgencia, prueba social, pregunta...).
- "texto": texto principal, 1 a 4 líneas, puede tener 1-2 emojis.
- "titulo": título corto, máximo 40 caracteres.
Respondé SOLO un JSON: [{"texto": "...", "titulo": "..."}]`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await res.json();
  if (j.error) return Response.json({ error: j.error.message }, { status: 500 });
  const txt: string = j.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
  try {
    const copys = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
    return Response.json({ copys: copys.slice(0, n) });
  } catch {
    return Response.json({ error: 'La IA no devolvió un formato válido, probá de nuevo' }, { status: 500 });
  }
}
