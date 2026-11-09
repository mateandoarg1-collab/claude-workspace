import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { conCache } from '@/lib/cache';
import { ventas } from '@/lib/localCajaVentas';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// Catálogo y métricas para la caja del local (mateando-local.vercel.app), así se actualiza sola sin redeploy:
// productos, precios, opciones y % de descuento por transferencia leídos de la tienda pública (www.mateandoarg.com),
// ranking y ventas del local (Acordar, pagadas) de emp_ordenes/emp_ventas. Cacheado 10 min en la CDN.
// Es la versión servidor de mateando-local/scripts/catalogo.mjs.
const BASE = 'https://www.mateandoarg.com';
const EMP = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const CORS = { 'access-control-allow-origin': 'https://mateando-local.vercel.app' };
const UA = { 'user-agent': 'Mozilla/5.0 mateando-local' };
const txt = async (u: string) => (await fetch(u, { headers: UA, cache: 'no-store' })).text();
const num = (s: string) => Number(s.replace(/[$.\s]/g, '').replace(',', '.'));
const limpio = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

type Variante = { id: number; precio: number; stock: number | null; op: Record<string, string> };
type Prod = { nombre: string; precio: number; transferencia: number | null; img: string; link: string; cat: string;
  id?: string | null; variantes?: Variante[]; unico?: number; vendidos?: number; vendidosLocal?: number; extra?: boolean };

async function catalogo() {
  const sitemap = await txt(`${BASE}/sitemap.xml`);
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const cats = urls.filter((u) => new URL(u).pathname.split('/').filter(Boolean).length === 1);
  const prods = new Map<string, Prod>();
  // categorías en paralelo (las páginas de cada una en orden)
  const porCat = await Promise.all(cats.map(async (c) => {
    const cat = limpio(c.split('/').pop()!.replace(/-/g, ' '));
    const out: Prod[] = [];
    const vistos = new Set<string>();
    for (let p = 1; p < 30; p++) {
      const h = await txt(p === 1 ? c : `${c}?page=${p}`);
      let nuevos = 0;
      for (const card of h.split('products-feed__product-name').slice(1)) {
        const link = card.match(/href="([^"]+)"/)?.[1];
        if (!link || vistos.has(link)) continue;
        vistos.add(link);
        const nombre = limpio(card.match(/>([\s\S]*?)<\/a>/)?.[1] ?? '');
        const pr = card.match(/products-feed__product-price[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '';
        const precio = num(limpio(pr.replace(/<del>[\s\S]*?<\/del>/, '')).match(/\$[\d.,]+/)?.[0] ?? '0');
        const trf = card.match(/tranfer-discount[\s\S]*?<strong>\$([\d.,]+)/)?.[1];
        const antes = h.slice(0, h.indexOf(card));
        const fotos = [...antes.slice(-12000).matchAll(/(?:src|data-src)="(https:\/\/d22fxaf9t8d39k[^"]+)"[^>]*alt="Producto - ([^"]*?)( - \d+)?"/g)];
        const img = fotos.find((f) => limpio(f[2]) === nombre)?.[1] ?? fotos.at(-1)?.[1] ?? '';
        out.push({ nombre, precio, transferencia: trf ? num(trf) : null, img, link, cat });
        nuevos++;
      }
      if (!nuevos) break;
    }
    return out;
  }));
  for (const lista of porCat) for (const x of lista) if (!prods.has(x.link)) prods.set(x.link, x);
  // Productos que no aparecen en los listados de categorías (9-nov-2026: faltaban los Torpedo): todas las URLs del
  // sitemap que no son categorías se leen como producto; las que no tienen `var stock` se descartan.
  const titulo = (c: string) => c.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  for (const u of urls) if (!cats.includes(u) && !prods.has(u) && new URL(u).pathname.split('/').filter(Boolean).length >= 2)
    prods.set(u, { nombre: '', precio: 0, transferencia: null, img: '', link: u, cat: titulo(new URL(u).pathname.split('/')[1]), extra: true } as Prod);

  const todos = [...prods.values()];
  for (let i = 0; i < todos.length; i += 12) {
    await Promise.all(todos.slice(i, i + 12).map(async (x) => {
      const h = await txt(x.link);
      x.id = h.match(/name="product" value="(\d+)"/)?.[1] ?? null;
      const st = h.match(/var stock = (\[[\s\S]*?\]);\s*\n/)?.[1];
      if (!st) return;
      if (x.extra) { // sacado del sitemap: nombre y foto de la página del producto
        const og = (k: string) => limpio(h.match(new RegExp(`property="og:${k}" content="([^"]*)"`))?.[1] ?? '');
        x.nombre = og('title'); x.img = og('image');
      }
      let arr: { idStock: number; s_oferta: number; s_precio_oferta: number; s_precio: number; s_ilimitado: number; s_cantidad: number;
        valoratributo?: { at_nombre: string; valor?: { vat_valor: string } }[] }[];
      try { arr = JSON.parse(st); } catch { return; }
      x.variantes = arr.map((v) => ({
        id: v.idStock, precio: v.s_oferta ? v.s_precio_oferta : v.s_precio, stock: v.s_ilimitado ? null : v.s_cantidad,
        op: Object.fromEntries((v.valoratributo ?? []).map((a) => [a.at_nombre, a.valor?.vat_valor ?? ''])),
      }));
      if (x.extra) { const m = Math.min(...x.variantes.map((v) => v.precio).filter((n) => n > 0)); x.precio = Number.isFinite(m) ? m : 0; }
      if (x.variantes.length === 1 && !Object.keys(x.variantes[0].op).length) { x.unico = x.variantes[0].id; delete x.variantes; }
    }));
  }
  // el mismo producto puede estar en varias categorías: uno por id
  const porId = new Map<string, Prod>();
  for (const x of todos) { if (!x.nombre || !(x.precio > 0)) continue; const k = x.id ?? x.link, y = porId.get(k); if (!y || (y.extra && !x.extra)) porId.set(k, x); }
  return [...porId.values()].map(({ extra: _e, ...x }) => x as Prod);
}

async function obtener() {
  try {
    const [prods, v] = await Promise.all([catalogo(), ventas()]);
    for (const x of prods) { x.vendidos = v.vendidos[x.id ?? ''] ?? 0; x.vendidosLocal = v.local[x.id ?? ''] ?? 0; }
    const productos = prods.filter((x) => x.precio > 0).sort((a, b) => (b.vendidosLocal! - a.vendidosLocal!) || (b.vendidos! - a.vendidos!) || a.nombre.localeCompare(b.nombre));
    const cuenta: Record<number, number> = {};
    for (const x of productos) if (x.transferencia) { const d = Math.round((1 - x.transferencia / x.precio) * 100); cuenta[d] = (cuenta[d] ?? 0) + 1; }
    const descTransferencia = Number(Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0);
    if (productos.length < 20) throw new Error(`Catálogo incompleto (${productos.length})`);
    return Response.json({ actualizado: new Date().toISOString(), descTransferencia, productos }, { headers: CORS }); // las ventas van por /api/local-metricas (con clave)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500, headers: CORS });
  }
}

export const GET = conCache(obtener, 600);
