// Cache en la CDN de Vercel para las APIs de solo lectura del panel: la misma consulta (misma URL, con su ?periodo=…)
// se responde desde la CDN durante `segundos` sin correr la función, y después se sigue mostrando mientras se renueva
// por detrás. Así varias pantallas abiertas no gastan el tiempo de procesamiento de Vercel (en nov-2026 la cuenta
// gratuita se pausó por eso). Solo se cachean las respuestas que salieron bien.
export function conCache<A extends unknown[]>(fn: (...a: A) => Promise<Response>, segundos: number) {
  return async (...a: A) => {
    const res = await fn(...a);
    if (!res.ok) return res;
    const h = new Headers(res.headers);
    h.set('Cache-Control', `public, s-maxage=${segundos}, stale-while-revalidate=${segundos * 5}`);
    return new Response(res.body, { status: res.status, headers: h });
  };
}
