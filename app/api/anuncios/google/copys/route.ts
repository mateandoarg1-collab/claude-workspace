export const maxDuration = 60;

// Textos para Google Ads generados por Claude a partir de la idea de Machado, respetando los límites de Google.
// tipo 'pmax' → títulos, títulos largos y descripciones. tipo 'busqueda' → títulos, descripciones y palabras clave.
const corta = (l: unknown, max: number, n: number) =>
  [...new Set((Array.isArray(l) ? l : []).map((s) => String(s).trim()).filter((s) => s && s.length <= max))].slice(0, n);

export async function POST(req: Request) {
  const { idea, tipo } = (await req.json()) as { idea: string; tipo: 'pmax' | 'busqueda' };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'Falta ANTHROPIC_API_KEY en Vercel' }, { status: 500 });
  if (!idea?.trim()) return Response.json({ error: 'Escribí la idea de la campaña' }, { status: 400 });
  const prompt = `Sos especialista en Google Ads para MATEANDO (mates, termos, bombillas y accesorios materos; tienda online argentina www.mateandoarg.com; envíos a todo el país).
Armá los textos de una campaña de ${tipo === 'pmax' ? 'Performance Max' : 'Búsqueda (anuncio responsivo)'} de Google Ads basada en esta idea:

"""${idea}"""

Reglas: español rioplatense, nada de promesas que no estén en la idea, sin signos de exclamación en títulos, sin MAYÚSCULAS sostenidas. Variá ángulos (producto, beneficio, oferta, envío, regalo, calidad, marca).
LÍMITES DUROS de caracteres (contá espacios): títulos ≤ 30, títulos largos ≤ 90, descripciones ≤ 90 (y al menos una ≤ 60).
Respondé SOLO un JSON:
${tipo === 'pmax'
    ? '{"titulos": [15 títulos], "titulosLargos": [5 títulos largos], "descripciones": [5 descripciones]}'
    : '{"titulos": [15 títulos], "descripciones": [4 descripciones], "palabras": [20 palabras clave de búsqueda con intención de compra, en minúscula, sin signos]}'}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await res.json();
  if (j.error) return Response.json({ error: j.error.message }, { status: 500 });
  const txt: string = j.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '';
  try {
    const o = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return Response.json({
      titulos: corta(o.titulos, 30, 15), titulosLargos: corta(o.titulosLargos, 90, 5),
      descripciones: corta(o.descripciones, 90, tipo === 'pmax' ? 5 : 4), palabras: corta(o.palabras, 80, 30),
    });
  } catch {
    return Response.json({ error: 'La IA no devolvió un formato válido, probá de nuevo' }, { status: 500 });
  }
}
