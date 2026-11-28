import { resumen, guardarFoto, editarProducto, agregarFilas, catalogo, parsearSkus, skuExcel, ahoraAR, listaEquivalencias, guardarEquivalencia, MOV, MOV_COLS, TIPOS, DESTINOS, CANALES_EQ, movimientos } from '@/lib/stock';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// API del stock del depósito. La usa la app aparte mateando-stock.vercel.app (repo mateandoarg1-collab/mateando-stock,
// rewrite de /api/stock a esta ruta). Acceso libre (pedido de Juampi, 15-nov-2026).
// GET → stock por SKU, últimos movimientos y ventas sin traducir. GET ?vista=eq → todas las equivalencias + catálogo con fotos.
// POST {accion:'mov', tipo, quien, nota, items:[{sku, cant}], antesDeAbrir?} → carga movimientos (Conteo antesDeAbrir = cierre de ayer).
// POST {accion:'eq', canal, clave, descripcion, skus, quien} → crea o corrige una equivalencia (publicación → SKUs) y la marca revisada por quien.
// POST {accion:'producto', sku, costo?, proveedores?:[p1,p2], quien} → cambia costo/proveedores en el Excel (log en "Stock Cambios").
// POST {accion:'foto', sku, foto} → guarda la foto de un producto (imagen chica en base64 o URL).
const txt = (x: unknown, max = 200) => String(x ?? '').trim().slice(0, max);
const no = (error: string) => Response.json({ error }, { status: 400 });

export async function GET(req: Request) {
  try {
    const vista = new URL(req.url).searchParams.get('vista');
    return Response.json(vista === 'eq' ? await listaEquivalencias() : await resumen(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b.accion === 'mov') {
    const tipo = txt(b.tipo, 20);
    if (!(TIPOS as readonly string[]).includes(tipo)) return no('Tipo inválido');
    const quien = txt(b.quien, 40);
    if (!quien) return no('Falta quién carga');
    const cat = new Map((await catalogo()).map((p) => [p.sku, p]));
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 300);
    // Conteo hecho antes de abrir: vale como cierre de ayer (así se descuentan todas las ventas de hoy).
    const ayer = new Date(Date.parse(`${ahoraAR().slice(0, 10)}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const fecha = tipo === 'Conteo' && b.antesDeAbrir ? `${ayer} 23:59` : ahoraAR();
    // Envío / Remito Mayorista: destino obligatorio y número de remito correlativo (va en la nota: "Remito 0001 · Local · …").
    let nota = txt(b.nota, 200), remito = 0;
    if (tipo === 'Envío' || tipo === 'Remito Mayorista') {
      const destino = txt(b.destino, 40);
      if (!DESTINOS.includes(destino)) return no('Elegí el destino');
      if ((tipo === 'Remito Mayorista') !== (destino === 'Mayorista')) return no('Destino inválido');
      remito = 1 + Math.max(0, ...(await movimientos()).map((m) => Number(m.nota.match(/^Remito (\d+)/)?.[1] ?? 0)));
      nota = [`Remito ${String(remito).padStart(4, '0')}`, destino, nota].filter(Boolean).join(' · ');
    }
    const filas: (string | number)[][] = [];
    for (const it of items) {
      const sku = txt(it.sku, 40).toUpperCase();
      const cant = Math.round(Number(it.cant));
      const p = cat.get(sku);
      if (!p) return no(`SKU desconocido: ${sku}`);
      if (!Number.isFinite(cant) || (tipo !== 'Ajuste' && cant < 0) || (tipo !== 'Conteo' && cant === 0)) return no(`Cantidad inválida en ${sku}`);
      filas.push([fecha, tipo, sku, p.nombre, cant, quien, nota]);
    }
    if (!filas.length) return no('No hay productos');
    await agregarFilas(MOV, MOV_COLS, filas);
    return Response.json({ ok: true, cargados: filas.length, remito, fecha, nota });
  }
  if (b.accion === 'eq') {
    const canal = txt(b.canal, 20);
    if (!CANALES_EQ.includes(canal)) return no('Canal inválido');
    const quien = txt(b.quien, 40);
    if (!quien) return no('Falta quién revisa');
    const skus = txt(b.skus, 300).toUpperCase();
    const lista = parsearSkus(skus);
    if (!lista) return no('Formato: SKU o SKU + SKU*2, o "-" si no descuenta');
    const cat = new Set((await catalogo()).map((p) => p.sku));
    const falta = lista.find(([s]) => !cat.has(skuExcel(s)));
    if (falta) return no(`SKU desconocido: ${falta[0]}`);
    const clave = txt(b.clave, 300);
    if (!clave) return no('Falta la publicación');
    await guardarEquivalencia({ canal, clave, descripcion: txt(b.descripcion, 300), skus: lista.map(([s, c]) => (c === 1 ? s : `${s}*${c}`)).join(' + ') || '-', revisado: quien });
    return Response.json({ ok: true });
  }
  if (b.accion === 'producto') {
    const quien = txt(b.quien, 40);
    if (!quien) return no('Falta quién hace el cambio');
    const cambios: { costo?: number; proveedores?: string[] } = {};
    if (b.costo !== undefined && b.costo !== '') {
      const c = Number(b.costo);
      if (!Number.isFinite(c) || c < 0 || c > 10_000_000) return no('Costo inválido');
      cambios.costo = Math.round(c * 100) / 100;
    }
    if (Array.isArray(b.proveedores)) cambios.proveedores = b.proveedores.slice(0, 2).map((x: unknown) => txt(x, 60));
    try {
      return Response.json({ ok: true, cambios: await editarProducto(txt(b.sku, 40).toUpperCase(), cambios, quien) });
    } catch (e) { return no(String((e as Error).message)); }
  }
  if (b.accion === 'foto') {
    const sku = txt(b.sku, 40).toUpperCase();
    const foto = String(b.foto ?? '');
    if (!(await catalogo()).some((p) => p.sku === sku)) return no(`SKU desconocido: ${sku}`);
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(foto) && !/^https:\/\/\S+$/.test(foto)) return no('Foto inválida');
    if (foto.length > 45000) return no('La foto es muy pesada');
    await guardarFoto(sku, foto);
    return Response.json({ ok: true });
  }
  return no('Acción inválida');
}
