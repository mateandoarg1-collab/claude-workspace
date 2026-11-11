// Migra los pedidos de las pestañas mensuales de "MATEANDO MAYORISTA 2026" (OCT 25 → NOV 26) a las pestañas "App …"
// que usa la app de pedidos mayoristas. Uso: node scripts/mayorista-migrar.mjs [--dry]
// Cada pedido del Excel son varias filas seguidas separadas por una fila vacía. De cada bloque sale un pedido:
// cliente = primera celda de CLIENTE; el resto de esa columna ("wen", "OCA", notas) va a observaciones.
// Los ítems importados no traen precio unitario (el Excel solo tiene el monto del pedido): precio 0, costo unitario
// = COSTO de la fila / unidades. Pedidos de meses anteriores a OCT 26 se marcan pagados y entregados (solo historial).
import { google } from 'googleapis';

const ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
const DRY = process.argv.includes('--dry');
const TABS = ['OCT 25', 'NOV 25', 'DIC 25', 'ENE 26', 'FEB 26.', 'MAR 26', 'ABR 26', 'MAY 26', 'JUN 26', 'JUL 26', 'AGO 26', 'SEPT 26', 'OCT 26', 'NOV 26'];
const RECIENTES = new Set(['OCT 26', 'NOV 26']);
const MES = { ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6, JUL: 7, AGO: 8, SEPT: 9, SEP: 9, OCT: 10, NOV: 11, DIC: 12 };

const auth = new google.auth.GoogleAuth({ keyFile: `${process.env.HOME}/.claude/.mateando-credentials.json`, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sh = google.sheets({ version: 'v4', auth });

const plata = (s) => { const t = String(s ?? '').replace(/[$\s]/g, ''); if (!t || /#/.test(t)) return 0; return Math.round(Number(t.replace(/\./g, '').replace(',', '.')) || 0); };
const si = (s) => /^(si|sí|true|ok|pagado)\b/i.test(String(s ?? '').trim());
const limpio = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

const pedidos = [], costos = new Map();
const VENDEDORES = new Set(['wen', 'luli', 'jp', 'juampi', 'juanpi', 'nacho', 'mau', 'lari']);
const NO_CLIENTE = /^(oca|env[ií]o|andreani|via cargo|retir|antes del|porfi|es un cambio|- cantidad|muestra|lunes|martes|miercoles|jueves|viernes|factura|las materas|reponemos|cred$|:|[0-9]+$)/i;
let nro = 1000;
for (const tab of TABS) {
  const [m, yy] = tab.replace('.', '').split(' ');
  const anio = 2000 + Number(yy), mes = MES[m];
  const filas = (await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'${tab}'!A1:AE1200` })).data.values ?? [];
  const hi = filas.findIndex((f) => f.some((c) => /^CLIENTE$/i.test(limpio(c))));
  if (hi < 0) { console.log(`${tab}: sin encabezado, salteo`); continue; }
  const H = filas[hi].map((c) => limpio(c).toUpperCase());
  const c = (re) => H.findIndex((h) => re.test(h));
  const C = { cli: c(/^CLIENTE$/), uni: c(/^(UNIDADES|CANTIDAD)$/), prod: c(/^(PRODUCTO|DETALLE)$/), pers: c(/^PERSONALIZADO$/),
    env: c(/TRANSPORTE|DOMICILIO/), obs: c(/^OBSERVACION/), pago: c(/^PAGO/), fent: c(/^FECHA DE ENTREGA/), neto: c(/^MONTO NETO/),
    iva: c(/^IVA$/), tot: c(/TOTAL$/), costo: c(/^COSTO$/), ent: c(/^(ENTREGADO|DESPACHADO)$/), forma: c(/^FORMA DE PAGO/) };
  const g = (f, k) => (C[k] >= 0 ? limpio(f[C[k]]) : '');

  const totalMes = (() => { const f = filas.slice(Math.max(0, hi - 2), hi + 4).find((x) => x !== filas[hi] && x && !g(x, 'prod') && !limpio(x[C.cli]) && plata(g(x, 'tot'))); return f ? plata(g(f, 'tot')) : 0; })();
  let mejor = null;
  for (const regla of [0, 1, 2]) {
  const salida = [], costosTab = new Map();
  let bloque = [];
  const cerrar = () => {
    const b = bloque; bloque = [];
    const conProd = b.filter((f) => g(f, 'prod'));
    const enB = b.map((f) => g(f, 'cli')).filter(Boolean);
    const vend = enB.find((x) => VENDEDORES.has(x.toLowerCase()));
    const cliente = enB.find((x) => !VENDEDORES.has(x.toLowerCase()) && !NO_CLIENTE.test(x)) || 'Sin nombre';
    if (!conProd.length && !b.some((f) => plata(g(f, 'neto')) || plata(g(f, 'tot')))) return;
    const textoA = b.map((f) => limpio(f[0])).find((x) => /^\d{1,2}\/\d{1,2}/.test(x));
    const [d, mm] = textoA ? textoA.split('/').map(Number) : [1, mes];
    const fecha = `${(mm || mes) > mes ? anio - 1 : anio}-${String(mm || mes).padStart(2, '0')}-${String(d || 1).padStart(2, '0')}`;
    const items = conProd.map((f) => {
      const cant = Number(g(f, 'uni').replace(/\D/g, '')) || 0, costoFila = plata(g(f, 'costo'));
      const nombre = g(f, 'prod');
      const cu = cant ? Math.round(costoFila / cant) : 0;
      if (cu) costosTab.set(nombre.toLowerCase(), { nombre, costo: cu });
      else if (!costosTab.has(nombre.toLowerCase())) costosTab.set(nombre.toLowerCase(), { nombre, costo: 0 });
      return { nombre, cant, precio: 0, costo: cu, pers: si(g(f, 'pers')) };
    });
    const primero = (k) => b.map((f) => plata(g(f, k))).find((x) => x) ?? 0;
    let neto = primero('neto'), iva = primero('iva'), total = primero('tot');
    if (!total) total = neto + iva;
    if (!neto) neto = total - iva;
    const costo = b.reduce((s, f) => s + plata(g(f, 'costo')), 0);
    const extras = enB.filter((x) => x !== cliente && x !== vend);
    const vendedor = vend ? vend[0].toUpperCase() + vend.slice(1).toLowerCase() : '';
    const obs = [...new Set([...extras, ...b.map((f) => g(f, 'obs')), ...b.map((f) => g(f, 'forma'))].filter(Boolean))].join(' · ');
    const envio = b.map((f) => g(f, 'env')).filter(Boolean).join('\n');
    const pagoTxt = b.map((f) => g(f, 'pago')).find(Boolean) ?? '';
    const reciente = RECIENTES.has(tab);
    const pagado = !reciente || si(pagoTxt);
    const entregado = !reciente || b.some((f) => si(g(f, 'ent')));
    salida.push([0, `${fecha} 00:00`, fecha, vendedor, cliente, JSON.stringify(items), neto, iva, total, costo,
      /retir/i.test(envio) || !envio ? 'Retiran' : 'Envío', /retir/i.test(envio) ? '' : envio.slice(0, 600), '', entregado ? 'Entregado' : 'Pendiente',
      JSON.stringify(pagado && total ? [{ fecha, monto: total, medio: 'Excel' }] : []),
      [pagoTxt && !si(pagoTxt) && !/^(no|false)$/i.test(pagoTxt) ? `Pago: ${pagoTxt}` : '', obs].filter(Boolean).join(' · ').slice(0, 500),
      `excel ${tab}`, '', iva ? 'SI' : 'NO', 'NO']);
  };
  // la fila de abajo (o arriba) del encabezado con los totales del mes no es un pedido
  const esTotales = (f) => f && !g(f, 'prod') && !limpio(f[C.cli]) && (plata(g(f, 'neto')) || plata(g(f, 'tot')));
  for (const f of filas.slice(hi + 1).filter((f, k) => !(k < 3 && esTotales(f)))) {
    if (f.every((x) => !limpio(x) || /^(true|false)$/i.test(limpio(x)))) { cerrar(); continue; }
    // pedido nuevo sin fila vacía en el medio: fecha en col A junto a un cliente
    // o fila con monto cuando el bloque ya tenía uno (cada pedido lleva su monto en su primera fila)
    const conMonto = (x) => plata(g(x, 'neto')) || plata(g(x, 'tot'));
    if (bloque.length && ((/^\d{1,2}\/\d{1,2}/.test(limpio(f[0])) && g(f, 'cli')) || (regla > 0 && conMonto(f) && (regla === 2 || g(f, 'cli')) && bloque.some(conMonto)))) cerrar();
    bloque.push(f);
  }
  cerrar();
  const suma = salida.reduce((s, p) => s + p[8], 0);
  if (!mejor || Math.abs(suma - totalMes) < Math.abs(mejor.suma - totalMes)) mejor = { suma, salida, costosTab, regla };
  }
  for (const p of mejor.salida) { p[0] = ++nro; pedidos.push(p); }
  for (const [k, v] of mejor.costosTab) if (v.costo || !costos.has(k)) costos.set(k, v);
  console.log(`${tab}: ${mejor.salida.length} pedidos · $${mejor.suma.toLocaleString('es-AR')} (Excel dice $${totalMes.toLocaleString('es-AR')}, regla ${mejor.regla})`);
}

const clientes = [...new Map(pedidos.map((p) => [p[4].toLowerCase(), [p[4], '', '', p[11], '', p[2]]])).values()];
const productos = [...costos.values()].map((x) => [x.nombre, 0, x.costo, 'SI']);
console.log(`Total: ${pedidos.length} pedidos · ${clientes.length} clientes · ${productos.length} productos · $${pedidos.reduce((s, p) => s + p[8], 0).toLocaleString('es-AR')}`);
if (process.argv.includes('--clientes')) console.log(clientes.map((c) => c[0]).join(' | '));
if (DRY) { for (const t of TABS) console.log(t, pedidos.filter((p) => p[16] === `excel ${t}`).reduce((s, p) => s + p[8], 0).toLocaleString("es-AR")); process.exit(0); }

const HOJAS = {
  'App Pedidos': [['nro', 'creado', 'fecha', 'vendedor', 'cliente', 'items', 'neto', 'iva', 'total', 'costo', 'entrega', 'direccion', 'fechaEntrega', 'estado', 'pagos', 'obs', 'origen', 'actualizado', 'conIva', 'anulado'], pedidos],
  'App Clientes': [['nombre', 'cuit', 'telefono', 'direccion', 'email', 'alta'], clientes],
  'App Productos': [['nombre', 'precio', 'costo', 'activo'], productos],
};
const meta = await sh.spreadsheets.get({ spreadsheetId: ID, fields: 'sheets.properties.title' });
const existe = new Set(meta.data.sheets.map((s) => s.properties.title));
for (const [t, [cab, filas]] of Object.entries(HOJAS)) {
  if (existe.has(t)) {
    const act = (await sh.spreadsheets.values.get({ spreadsheetId: ID, range: `'${t}'!A2:Q` })).data.values ?? [];
    if (t === 'App Pedidos' && act.some((f) => f[16] === 'app')) throw new Error('App Pedidos ya tiene pedidos cargados desde la app: no piso nada');
    await sh.spreadsheets.values.clear({ spreadsheetId: ID, range: `'${t}'!A:Z` });
  } else {
    await sh.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }] } });
  }
  await sh.spreadsheets.values.update({ spreadsheetId: ID, range: `'${t}'!A1`, valueInputOption: 'RAW', requestBody: { values: [cab, ...filas] } });
  console.log(`✔ ${t}: ${filas.length} filas`);
}
