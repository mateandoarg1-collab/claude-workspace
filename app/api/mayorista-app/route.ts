import { leer, agregar, reemplazar, aPedido, dePedido, num, ahoraAR, hoyAR, type Item, type Pago } from '@/lib/mayoristaApp';

export const dynamic = 'force-dynamic';

// API de la app de pedidos mayoristas (mateando-mayorista.vercel.app). Cada vendedor entra con su PIN (header x-pin,
// pestaña "App Vendedores"); MAYORISTA_ADMIN_PIN (env) entra siempre como admin aunque la pestaña esté vacía.
// Los vendedores ven solo sus pedidos y sin costos; el admin ve todo, costos y ganancia, y administra vendedores.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-pin',
};
const ok = (d: unknown, status = 200) => Response.json(d, { status, headers: { ...CORS, 'cache-control': 'no-store' } });
const txt = (x: unknown, max = 200) => String(x ?? '').trim().slice(0, max);
const ESTADOS = ['Pendiente', 'Armado', 'Entregado'];

// De momento (pedido de Juampi, 11-nov-2026) se entra sin PIN: sin PIN = admin "Equipo". Para volver a exigirlo: false.
const SIN_PIN = true;

type Yo = { nombre: string; admin: boolean };
async function quien(req: Request): Promise<Yo | null> {
  const pin = txt(req.headers.get('x-pin'), 20);
  if (!pin) return SIN_PIN ? { nombre: 'Equipo', admin: true } : null;
  if (process.env.MAYORISTA_ADMIN_PIN && pin === process.env.MAYORISTA_ADMIN_PIN) return { nombre: 'Juampi', admin: true };
  const v = (await leer('vendedores')).find((f) => f[1] === pin && f[3] !== 'NO');
  return v ? { nombre: v[0], admin: v[2] === 'SI' } : null;
}

export async function OPTIONS() { return new Response(null, { headers: CORS }); }

export async function GET(req: Request) {
  try {
    const yo = await quien(req);
    if (!yo) return ok({ error: 'PIN incorrecto' }, 401);
    const [ped, cli, prod, ven] = await Promise.all([leer('pedidos'), leer('clientes'), leer('productos'), yo.admin ? leer('vendedores') : Promise.resolve([])]);
    let pedidos = ped.filter((f) => f[0]).map(aPedido);
    if (!yo.admin) pedidos = pedidos.filter((p) => p.vendedor.toLowerCase() === yo.nombre.toLowerCase())
      .map((p) => ({ ...p, costo: 0, items: p.items.map((i) => ({ ...i, costo: 0 })) }));
    pedidos.sort((a, b) => (b.fecha + b.nro).localeCompare(a.fecha + a.nro) || b.nro - a.nro);
    const clientes = cli.filter((f) => f[0]).map((f) => ({ nombre: f[0], cuit: f[1], telefono: f[2], direccion: f[3], email: f[4] }));
    const productos = prod.filter((f) => f[0] && f[3] !== 'NO').map((f) => ({ nombre: f[0], precio: num(f[1]), costo: yo.admin ? num(f[2]) : 0, foto: f[4] ?? '' }));
    const vendedores = ven.filter((f) => f[0]).map((f) => ({ nombre: f[0], pin: f[1], admin: f[2] === 'SI', activo: f[3] !== 'NO' }));
    return ok({ yo, pedidos, clientes, productos, vendedores });
  } catch (e) {
    return ok({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const yo = await quien(req);
    if (!yo) return ok({ error: 'PIN incorrecto' }, 401);
    const b = await req.json();
    const ped = await leer('pedidos');
    const buscar = (nro: unknown) => {
      const i = ped.findIndex((f) => num(f[0]) === num(nro));
      if (i < 0) throw new Error('No existe ese pedido');
      const p = aPedido(ped[i]);
      if (!yo.admin && p.vendedor.toLowerCase() !== yo.nombre.toLowerCase()) throw new Error('Ese pedido es de otro vendedor');
      return { i, p };
    };

    if (b.accion === 'pedido') {
      const prod = await leer('productos');
      const costoDe = new Map(prod.map((f) => [f[0].toLowerCase(), num(f[2])]));
      const items: Item[] = (Array.isArray(b.items) ? b.items : []).slice(0, 80).map((x: Record<string, unknown>) => ({
        nombre: txt(x.nombre, 160), cant: num(x.cant), precio: num(x.precio), pers: !!x.pers,
        costo: costoDe.get(txt(x.nombre, 160).toLowerCase()) ?? 0,
      })).filter((x: Item) => x.nombre && x.cant > 0);
      const cliente = txt(b.cliente, 120);
      if (!cliente) return ok({ error: 'Falta el cliente' }, 400);
      if (!items.length) return ok({ error: 'El pedido no tiene productos' }, 400);
      const conIva = b.conIva !== false;
      const neto = items.reduce((s, x) => s + x.cant * x.precio, 0);
      const iva = conIva ? Math.round(neto * 0.21) : 0;
      const costo = items.reduce((s, x) => s + x.cant * x.costo, 0);
      const base = { cliente, items, neto, iva, total: neto + iva, costo, conIva, entrega: txt(b.entrega, 40) || 'Retiran',
        direccion: txt(b.direccion, 300), fechaEntrega: txt(b.fechaEntrega, 10), obs: txt(b.obs, 500), actualizado: ahoraAR() };

      // cliente nuevo → a la pestaña de clientes (o completar dirección/teléfono si faltaban)
      const cli = await leer('clientes');
      const ci = cli.findIndex((f) => f[0].toLowerCase() === cliente.toLowerCase());
      const c = b.datosCliente ?? {};
      if (ci < 0) await agregar('clientes', [[cliente, txt(c.cuit, 20), txt(c.telefono, 40), txt(c.direccion || b.direccion, 300), txt(c.email, 120), hoyAR()]]);
      else {
        const f = [...cli[ci]]; while (f.length < 6) f.push('');
        const nuevo = [f[0], f[1] || txt(c.cuit, 20), f[2] || txt(c.telefono, 40), f[3] || txt(c.direccion || b.direccion, 300), f[4] || txt(c.email, 120), f[5]];
        if (nuevo.join('|') !== f.join('|')) await reemplazar('clientes', ci, nuevo);
      }
      // precio nuevo → queda como precio sugerido; producto nuevo → se agrega al catálogo
      const nuevos = items.filter((x) => !costoDe.has(x.nombre.toLowerCase()));
      await agregar('productos', [...new Map(nuevos.map((x) => [x.nombre.toLowerCase(), [x.nombre, x.precio, 0, 'SI', '']])).values()]);

      if (b.nro) {
        const { i, p } = buscar(b.nro);
        await reemplazar('pedidos', i, dePedido({ ...p, ...base, fecha: txt(b.fecha, 10) || p.fecha }));
        return ok({ ok: true, nro: p.nro });
      }
      const nro = Math.max(1000, ...ped.map((f) => num(f[0]))) + 1;
      const pagos: Pago[] = num(b.pagoInicial?.monto) > 0 ? [{ fecha: hoyAR(), monto: num(b.pagoInicial.monto), medio: txt(b.pagoInicial.medio, 30) || 'Transferencia' }] : [];
      await agregar('pedidos', [dePedido({ nro, creado: ahoraAR(), fecha: txt(b.fecha, 10) || hoyAR(), vendedor: yo.admin && b.vendedor ? txt(b.vendedor, 40) : yo.nombre,
        estado: 'Pendiente', pagos, origen: 'app', anulado: false, ...base })]);
      return ok({ ok: true, nro });
    }

    if (b.accion === 'pago') {
      const { i, p } = buscar(b.nro);
      const monto = num(b.monto);
      if (!monto) return ok({ error: 'Falta el monto' }, 400);
      p.pagos.push({ fecha: txt(b.fecha, 10) || hoyAR(), monto, medio: txt(b.medio, 30) || 'Transferencia', nota: txt(b.nota, 200) || undefined });
      await reemplazar('pedidos', i, dePedido({ ...p, actualizado: ahoraAR() }));
      return ok({ ok: true });
    }
    if (b.accion === 'borrarPago') {
      const { i, p } = buscar(b.nro);
      p.pagos.splice(num(b.idx), 1);
      await reemplazar('pedidos', i, dePedido({ ...p, actualizado: ahoraAR() }));
      return ok({ ok: true });
    }
    if (b.accion === 'estado') {
      const { i, p } = buscar(b.nro);
      if (!ESTADOS.includes(b.estado)) return ok({ error: 'Estado inválido' }, 400);
      await reemplazar('pedidos', i, dePedido({ ...p, estado: b.estado, actualizado: ahoraAR() }));
      return ok({ ok: true });
    }
    if (b.accion === 'anular') {
      const { i, p } = buscar(b.nro);
      await reemplazar('pedidos', i, dePedido({ ...p, anulado: !p.anulado, actualizado: ahoraAR() }));
      return ok({ ok: true });
    }
    if (b.accion === 'cliente') {
      const cli = await leer('clientes');
      const nombre = txt(b.nombre, 120);
      if (!nombre) return ok({ error: 'Falta el nombre' }, 400);
      const fila = [nombre, txt(b.cuit, 20), txt(b.telefono, 40), txt(b.direccion, 300), txt(b.email, 120)];
      const ci = cli.findIndex((f) => f[0].toLowerCase() === txt(b.original || nombre, 120).toLowerCase());
      if (ci < 0) await agregar('clientes', [[...fila, hoyAR()]]); else await reemplazar('clientes', ci, [...fila, cli[ci][5] ?? hoyAR()]);
      return ok({ ok: true });
    }

    if (!yo.admin) return ok({ error: 'Solo el administrador' }, 403);
    if (b.accion === 'producto') {
      const prod = await leer('productos');
      const nombre = txt(b.nombre, 160);
      const pi0 = prod.findIndex((f) => f[0].toLowerCase() === txt(b.original || nombre, 160).toLowerCase());
      // foto: URL o miniatura data:image/jpeg (entra en una celda, < 50 mil caracteres). Sin foto nueva queda la que tenía.
      const foto = typeof b.foto === 'string' && /^(https:\/\/|data:image\/jpeg;base64,)/.test(b.foto) && b.foto.length < 49000 ? b.foto : (pi0 >= 0 ? prod[pi0][4] ?? '' : '');
      const fila = [nombre, num(b.precio), num(b.costo), b.activo === false ? 'NO' : 'SI', b.foto === '' ? '' : foto];
      const pi = prod.findIndex((f) => f[0].toLowerCase() === txt(b.original || nombre, 160).toLowerCase());
      if (pi < 0) await agregar('productos', [fila]); else await reemplazar('productos', pi, fila);
      return ok({ ok: true });
    }
    if (b.accion === 'vendedor') {
      const ven = await leer('vendedores');
      const nombre = txt(b.nombre, 40), pin = txt(b.pin, 20);
      if (!nombre || pin.length < 4) return ok({ error: 'Nombre y PIN de 4+ dígitos' }, 400);
      if (ven.some((f) => f[1] === pin && f[0].toLowerCase() !== txt(b.original || nombre, 40).toLowerCase())) return ok({ error: 'Ese PIN ya lo usa otro' }, 400);
      const fila = [nombre, pin, b.admin ? 'SI' : 'NO', b.activo === false ? 'NO' : 'SI'];
      const vi = ven.findIndex((f) => f[0].toLowerCase() === txt(b.original || nombre, 40).toLowerCase());
      if (vi < 0) await agregar('vendedores', [fila]); else await reemplazar('vendedores', vi, fila);
      return ok({ ok: true });
    }
    return ok({ error: 'Acción desconocida' }, 400);
  } catch (e) {
    return ok({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
