import { resumen, guardarFoto, agregarFilas, catalogo, parsearSkus, skuExcel, ahoraAR, MOV, MOV_COLS, EQ, EQ_COLS, TIPOS } from '@/lib/stock';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// API del stock del depósito. La usa la app aparte mateando-stock.vercel.app (repo mateandoarg1-collab/mateando-stock,
// rewrite de /api/stock a esta ruta). Acceso libre (pedido de Juampi, 15-nov-2026).
// GET → stock por SKU, últimos movimientos y ventas sin traducir.
// POST {accion:'mov', tipo, quien, nota, items:[{sku, cant}]} → carga movimientos.
// POST {accion:'eq', canal, clave, descripcion, skus} → guarda una equivalencia (publicación → SKUs).
// POST {accion:'foto', sku, foto} → guarda la foto de un producto (imagen chica en base64 o URL).
const txt = (x: unknown, max = 200) => String(x ?? '').trim().slice(0, max);
const no = (error: string) => Response.json({ error }, { status: 400 });

export async function GET() {
  try {
    return Response.json(await resumen(), { headers: { 'cache-control': 'no-store' } });
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
    const fecha = ahoraAR();
    const filas: (string | number)[][] = [];
    for (const it of items) {
      const sku = txt(it.sku, 40).toUpperCase();
      const cant = Math.round(Number(it.cant));
      const p = cat.get(sku);
      if (!p) return no(`SKU desconocido: ${sku}`);
      if (!Number.isFinite(cant) || (tipo !== 'Ajuste' && cant < 0) || (tipo !== 'Conteo' && cant === 0)) return no(`Cantidad inválida en ${sku}`);
      filas.push([fecha, tipo, sku, p.nombre, cant, quien, txt(b.nota, 200)]);
    }
    if (!filas.length) return no('No hay productos');
    await agregarFilas(MOV, MOV_COLS, filas);
    return Response.json({ ok: true, cargados: filas.length });
  }
  if (b.accion === 'eq') {
    const canal = txt(b.canal, 20);
    if (!['MeLi', 'Shopify', 'Mayorista'].includes(canal)) return no('Canal inválido');
    const skus = txt(b.skus, 300).toUpperCase();
    const lista = parsearSkus(skus);
    if (!lista) return no('Formato: SKU o SKU + SKU*2, o "-" si no descuenta');
    const cat = new Set((await catalogo()).map((p) => p.sku));
    const falta = lista.find(([s]) => !cat.has(skuExcel(s)));
    if (falta) return no(`SKU desconocido: ${falta[0]}`);
    await agregarFilas(EQ, EQ_COLS, [[canal, txt(b.clave, 300), txt(b.descripcion, 300), skus, ahoraAR()]]);
    return Response.json({ ok: true });
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
