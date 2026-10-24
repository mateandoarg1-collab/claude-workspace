// Órdenes y catálogo de Empretienda → planilla (pestañas emp_ordenes y emp_productos), para /estadisticas.
// Empretienda no tiene API pública, pero el panel usa una interna con el token de la sesión: se toma el header
// Authorization de los pedidos que hace el propio panel y se reusa. Lo llama empretienda-metricas.mjs con la página
// ya logueada. Sin datos personales (el repo es público y la planilla se comparte): solo id, fecha, montos, medio y
// estado de pago, provincia y productos.
//
// payment.status: 1 pagada · 0 pendiente (transferencia sin confirmar) · 4 devuelta · 5 rechazada/abandonada.
// payment.method: 1 Mercado Pago · 3 Acordar (Local) · 5 Transferencia · 8 GoCuotas.

const ORDENES = 'https://dashboard.empretienda.ar.ua.la/1/orders';
const PRODUCTOS = 'https://api.empretienda.com/producto';
const DIAS = 60;
const DESDE_CHINA = '2026-09-01T03:00:00Z'; // /china cuenta las ventas desde que llegó el container: no se borran
const RECIENTES = 7;
const IMG = 'https://d22fxaf9t8d39k.cloudfront.net/';

// Abre una pantalla del panel y devuelve el Authorization que usó contra `host`.
async function token(page, url, host) {
  let auth;
  const ver = (r) => { if (r.url().includes(host) && r.headers().authorization) auth = r.headers().authorization; };
  page.on('request', ver);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  for (let i = 0; i < 30 && !auth; i++) await page.waitForTimeout(1000);
  page.off('request', ver);
  if (!auth) throw new Error(`El panel no hizo pedidos a ${host}`);
  return auth;
}

// Con reintentos: las páginas viejas del listado tardan. Los errores de Playwright traen el token y las cookies en el
// "Call log": nunca se relanzan tal cual (los logs de Actions son públicos).
async function json(page, url, auth) {
  const ruta = new URL(url);
  for (let i = 1; ; i++) {
    try {
      const r = await page.request.get(url, { headers: { authorization: auth, accept: 'application/json' }, timeout: 90000 });
      if (r.ok()) return r.json();
      if (i === 3) throw new Error(`HTTP ${r.status()}`);
    } catch (e) {
      if (i === 3) throw new Error(`${ruta.pathname}?${ruta.searchParams.get('page') ?? ''}: ${String(e?.message ?? e).split('\n')[0]}`);
    }
    await page.waitForTimeout(3000 * i);
  }
}

// Órdenes creadas en los últimos `dias` días (el listado viene de la más nueva a la más vieja).
export async function leerOrdenes(page, dias) {
  const auth = await token(page, 'https://panel.empretienda.com/listado-de-ventas', 'ar.ua.la/1/orders');
  const corte = new Date(Date.now() - dias * 864e5).toISOString();
  const filas = new Map();
  for (const archived of [0, 1]) {
    for (let p = 0; p < 200; p++) {
      const lote = await json(page, `${ORDENES}?page=${p}&limit=100&sort=1&archived=${archived}`, auth);
      for (const o of lote) {
        if (o.created_at < corte) continue;
        filas.set(o.id, [
          o.id.replace(/^order-/, ''), // el mismo order_id que queda en la URL de la página de gracias (/order) en GA4
          o.number,
          o.created_at,
          o.total,
          o.payment?.method ?? '',
          o.payment?.status ?? '',
          o.shipping?.address?.state ?? '',
          (o.products ?? []).map((x) => `${String(x.product_id).replace(/^product-/, '')}:${x.quantity}`).join(','),
        ]);
      }
      if (lote.length < 100 || lote.at(-1).created_at < corte) break;
    }
  }
  return [...filas.values()].sort((a, b) => String(b[2]).localeCompare(String(a[2])));
}

export async function leerProductos(page) {
  const auth = await token(page, 'https://panel.empretienda.com/productos', 'api.empretienda.com/producto');
  const filas = [];
  for (let p = 0; p < 50; p++) {
    const { data } = await json(page, `${PRODUCTOS}?idCategorias=0&p_tipo_venta=-1&p_producto_digital=-1&p_oferta=-1&estado_stock=-1&orden=0&page=${p}&search=&search_codigo=&limit=100`, auth);
    for (const x of data ?? []) filas.push([x.idProductos, x.p_nombre, x.p_link, x.p_desactivado, x.imagenes?.[0]?.i_link ? `${IMG}${x.imagenes[0].i_link}` : '']);
    if (!data || data.length < 100) break;
  }
  return filas;
}

async function escribir(sheets, spreadsheetId, tab, encabezado, filas) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  if (!meta.data.sheets.some((s) => s.properties.title === tab)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
  }
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${tab}'!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tab}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [encabezado, ...filas] },
  });
}

// Bajar 60 días tarda ~6 min (hay ~140 órdenes por día contando intentos de pago fallidos): cada corrida baja solo los
// últimos 7 días, que es donde cambian los estados de pago, y conserva lo anterior que ya estaba en la pestaña.
export async function volcarOrdenes(page, sheets, spreadsheetId) {
  const t0 = Date.now();
  const seg = () => `${Math.round((Date.now() - t0) / 1000)} s`;
  const previas = (await sheets.spreadsheets.values.get({ spreadsheetId, range: "'emp_ordenes'!A2:H", valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null))?.data.values ?? [];
  const desde = previas.length ? RECIENTES : DIAS;
  const nuevas = await leerOrdenes(page, desde);
  console.log(`Órdenes de ${desde} días bajadas (${seg()})`);
  const corteNuevas = new Date(Date.now() - desde * 864e5).toISOString();
  const corte = new Date(Math.min(Date.now() - DIAS * 864e5, Date.parse(DESDE_CHINA))).toISOString();
  const ids = new Set(nuevas.map((o) => o[0]));
  const ordenes = [...nuevas, ...previas.filter((o) => o[2] >= corte && o[2] < corteNuevas && !ids.has(o[0]))];
  await escribir(sheets, spreadsheetId, 'emp_ordenes', ['order_id', 'numero', 'fecha', 'total', 'metodo', 'pago', 'provincia', 'productos'], ordenes);
  console.log(`emp_ordenes escrita (${seg()})`);
  const productos = await leerProductos(page);
  await escribir(sheets, spreadsheetId, 'emp_productos', ['id', 'nombre', 'link', 'desactivado', 'imagen'], productos);
  console.log(`Órdenes de los últimos ${DIAS} días: ${ordenes.length} · productos: ${productos.length} (${seg()})`);
}
