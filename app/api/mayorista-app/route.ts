import { leer, agregar, reemplazar, aPedido, dePedido, num, ahoraAR, hoyAR, type Item, type Pago } from '@/lib/mayoristaApp';
import { cuitValido, emitirFactura, llamar } from '@/lib/ecommapp';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Punto de venta de Ecomm-App para las facturas mayoristas (0 = todavía sin definir: el botón Facturar avisa).
const PUNTO_VENTA_MAYORISTA = 0;

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
    // ?puntos=1 (admin): puntos de venta usados en Ecomm-App los últimos 90 días, con cuántas facturas fueron a CUITs
    // de clientes mayoristas. Sirve para elegir PUNTO_VENTA_MAYORISTA.
    if (yo.admin && new URL(req.url).searchParams.get('puntos')) return ok(await puntosDeVenta());
    const [ped, cli, prod, ven] = await Promise.all([leer('pedidos'), leer('clientes'), leer('productos'), yo.admin ? leer('vendedores') : Promise.resolve([])]);
    let pedidos = ped.filter((f) => f[0]).map(aPedido);
    if (!yo.admin) pedidos = pedidos.filter((p) => p.vendedor.toLowerCase() === yo.nombre.toLowerCase())
      .map((p) => ({ ...p, costo: 0, items: p.items.map((i) => ({ ...i, costo: 0 })) }));
    pedidos.sort((a, b) => (b.fecha + b.nro).localeCompare(a.fecha + a.nro) || b.nro - a.nro);
    const clientes = cli.filter((f) => f[0]).map((f) => ({ nombre: f[0], cuit: f[1], telefono: f[2], direccion: f[3], email: f[4] }));
    const productos = prod.filter((f) => f[0] && f[3] !== 'NO').map((f) => ({ nombre: f[0], precio: num(f[1]), costo: yo.admin ? num(f[2]) : 0, foto: f[4] ?? '',
      colores: (f[5] ?? '').split(',').map((c) => c.trim()).filter(Boolean) }));
    // nombre viejo (en minúscula) → producto del catálogo, para sumar ventas y mostrar foto en pedidos viejos
    const alias = Object.fromEntries(prod.filter((f) => f[0] && f[6]).map((f) => [f[0].toLowerCase(), f[6]]));
    const vendedores = ven.filter((f) => f[0]).map((f) => ({ nombre: f[0], pin: f[1], admin: f[2] === 'SI', activo: f[3] !== 'NO' }));
    return ok({ yo, pedidos, clientes, productos, alias, vendedores });
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
      if (b.nro && buscar(b.nro).p.factura) return ok({ error: 'El pedido ya está facturado: no se puede editar' }, 400);
      const prod = await leer('productos');
      const costoDe = new Map(prod.map((f) => [f[0].toLowerCase(), num(f[2])]));
      const items: Item[] = (Array.isArray(b.items) ? b.items : []).slice(0, 80).map((x: Record<string, unknown>) => ({
        nombre: txt(x.nombre, 160), cant: num(x.cant), precio: num(x.precio), pers: !!x.pers, ...(txt(x.color, 40) ? { color: txt(x.color, 40) } : {}),
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
      await agregar('productos', [...new Map(nuevos.map((x) => [x.nombre.toLowerCase(), [x.nombre, x.precio, 0, 'SI', '', '', '']])).values()]);

      if (b.nro) {
        const { i, p } = buscar(b.nro);
        await reemplazar('pedidos', i, dePedido({ ...p, ...base, fecha: txt(b.fecha, 10) || p.fecha }));
        return ok({ ok: true, nro: p.nro });
      }
      const nro = Math.max(1000, ...ped.map((f) => num(f[0]))) + 1;
      const presupuesto = !!b.presupuesto;
      const pagos: Pago[] = !presupuesto && num(b.pagoInicial?.monto) > 0 ? [{ fecha: hoyAR(), monto: num(b.pagoInicial.monto), medio: txt(b.pagoInicial.medio, 30) || 'Transferencia' }] : [];
      await agregar('pedidos', [dePedido({ nro, creado: ahoraAR(), fecha: txt(b.fecha, 10) || hoyAR(), vendedor: yo.admin && b.vendedor ? txt(b.vendedor, 40) : yo.nombre,
        estado: presupuesto ? 'Presupuesto' : 'Pendiente', pagos, origen: 'app', anulado: false, factura: null, ...base })]);
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
    if (b.accion === 'aprobar') {
      // presupuesto aprobado → pedido: la fecha pasa a ser la de hoy (es cuando se vende)
      const { i, p } = buscar(b.nro);
      if (p.estado !== 'Presupuesto') return ok({ error: 'Ese pedido no es un presupuesto' }, 400);
      await reemplazar('pedidos', i, dePedido({ ...p, estado: 'Pendiente', fecha: hoyAR(), actualizado: ahoraAR() }));
      return ok({ ok: true });
    }
    if (b.accion === 'facturar') {
      if (!yo.admin) return ok({ error: 'Solo el administrador puede facturar' }, 403);
      const { i, p } = buscar(b.nro);
      if (p.factura) return ok({ ok: true, factura: p.factura, yaExistia: true });
      if (p.anulado) return ok({ error: 'El pedido está anulado' }, 400);
      if (p.estado === 'Presupuesto') return ok({ error: 'Primero aprobá el presupuesto' }, 400);
      if (!p.conIva) return ok({ error: 'Este pedido está cargado sin factura. Editalo y marcá "Con IVA" si hay que facturarlo.' }, 400);
      if (p.items.some((x) => !x.precio)) return ok({ error: 'Hay productos sin precio' }, 400);
      if (!PUNTO_VENTA_MAYORISTA) return ok({ error: 'Falta definir el punto de venta de Ecomm-App para mayorista' }, 400);
      const documento = txt(b.documento, 20).replace(/\D/g, '');
      if (!cuitValido(documento)) return ok({ error: 'El CUIT no es válido (son 11 números)' }, 400);
      const email = txt(b.email, 120);
      // Ecomm-App toma el precio unitario CON IVA (igual que en la caja del local) y elige A o B según el CUIT.
      const fa = await emitirFactura({
        clave: `mateando-mayorista-${p.nro}-${documento}`, documento, puntoVenta: PUNTO_VENTA_MAYORISTA,
        referencia: `MAY-${p.nro}`, notas: `Pedido mayorista N° ${p.nro}`, email: /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : undefined,
        items: p.items.map((x) => ({ description: (x.nombre + (x.color ? ' - ' + x.color : '') + (x.pers ? ' (personalizado)' : '')).slice(0, 200),
          quantity: x.cant, unit_price: Math.round(x.precio * 121) / 100, vat_rate_id: 5 })),
      });
      const factura = { numero: fa.numero, tipo: fa.tipo, cae: fa.cae, vence: fa.vence, pdf: fa.pdf, total: fa.total, doc: documento, nombre: fa.nombre, fecha: hoyAR() };
      await reemplazar('pedidos', i, dePedido({ ...p, factura, actualizado: ahoraAR() }));
      // el CUIT queda en la ficha del cliente si no lo tenía
      const cli = await leer('clientes');
      const ci = cli.findIndex((f) => f[0].toLowerCase() === p.cliente.toLowerCase());
      if (ci >= 0 && !cli[ci][1]) { const f = [...cli[ci]]; while (f.length < 6) f.push(''); f[1] = documento; if (!f[4] && email) f[4] = email; await reemplazar('clientes', ci, f); }
      return ok({ ok: true, factura });
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
      const colores = typeof b.colores === 'string' ? b.colores.split(',').map((c: string) => txt(c, 40)).filter(Boolean).join(',') : (pi0 >= 0 ? prod[pi0][5] ?? '' : '');
      const fila = [nombre, num(b.precio), num(b.costo), b.activo === false ? 'NO' : 'SI', b.foto === '' ? '' : foto, colores, pi0 >= 0 ? prod[pi0][6] ?? '' : ''];
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

async function puntosDeVenta() {
  const cuits = new Set((await leer('clientes')).map((f) => String(f[1] ?? '').replace(/\D/g, '')).filter((c) => c.length === 11));
  const hasta = hoyAR(), desde = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const manuales: Record<string, unknown>[] = [];
  const g: Record<string, { facturas: number; aMayoristas: number; canales: Record<string, number>; ejemplos: string[] }> = {};
  for (let page = 1; page <= 40; page++) {
    const j = await llamar(`/comprobantes?${new URLSearchParams({ date_from: desde, date_to: hasta, per_page: '50', page: String(page), sort: 'fecha_desc' })}`);
    const data: { invoice?: { full_number?: string; sales_channel?: string }; customer?: { document_number?: string; first_name?: string; last_name?: string } }[] =
      Array.isArray(j.data?.items) ? j.data.items : Array.isArray(j.data) ? j.data : [];
    for (const c of data) {
      const pv = String(c.invoice?.full_number ?? '').split('-')[0] || '?';
      const x = (g[pv] ||= { facturas: 0, aMayoristas: 0, canales: {}, ejemplos: [] });
      x.facturas++;
      const canal = c.invoice?.sales_channel || '—'; x.canales[canal] = (x.canales[canal] || 0) + 1;
      if (canal !== 'mercadolibre' && canal !== 'empretienda' && canal !== 'mercadopago' && manuales.length < 40)
        manuales.push({ numero: c.invoice?.full_number, fecha: (c.invoice as { issue_date?: string })?.issue_date, canal, cliente: [c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(' '),
          total: (c as { amounts?: { total?: number } }).amounts?.total, tipo: (c.invoice as { type?: { letra?: string } })?.type?.letra });
      if (cuits.has(String(c.customer?.document_number ?? ''))) {
        x.aMayoristas++;
        if (x.ejemplos.length < 5) x.ejemplos.push([c.customer?.first_name, c.customer?.last_name].filter(Boolean).join(' '));
      }
    }
    const tp = Number(j.data?.pagination?.total_pages ?? j.pagination?.total_pages ?? 0);
    if (!data.length || (tp ? page >= tp : data.length < 50)) break;
  }
  return { desde, hasta, clientesConCuit: cuits.size, puntos: g, manuales };
}
