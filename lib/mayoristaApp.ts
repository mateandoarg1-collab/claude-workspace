import { google } from 'googleapis';
import { getAuth } from './sheets';

// App de pedidos mayoristas (mateando-mayorista.vercel.app). Reemplaza la carga a mano de las pestañas mensuales de
// "MATEANDO MAYORISTA 2026". Todo vive en pestañas "App …" de esa misma planilla:
//  · App Pedidos     nro · creado · fecha · vendedor · cliente · items(JSON) · neto · iva · total · costo · entrega ·
//                    direccion · fechaEntrega · estado · pagos(JSON) · obs · origen · actualizado · conIva · anulado
//  · App Clientes    nombre · cuit · telefono · direccion · email · alta
//  · App Productos   nombre · precio · costo · activo · foto (URL o miniatura JPEG en base64) · colores (separados por coma)
//                    · es (producto del catálogo al que equivale un nombre viejo del Excel; sus ventas se suman ahí)
//  · App Vendedores  nombre · pin · admin(SI/NO) · activo
export const ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';
export const HOJAS = {
  pedidos: { t: 'App Pedidos', cols: ['nro', 'creado', 'fecha', 'vendedor', 'cliente', 'items', 'neto', 'iva', 'total', 'costo', 'entrega', 'direccion', 'fechaEntrega', 'estado', 'pagos', 'obs', 'origen', 'actualizado', 'conIva', 'anulado'] },
  clientes: { t: 'App Clientes', cols: ['nombre', 'cuit', 'telefono', 'direccion', 'email', 'alta'] },
  productos: { t: 'App Productos', cols: ['nombre', 'precio', 'costo', 'activo', 'foto', 'colores', 'es'] },
  vendedores: { t: 'App Vendedores', cols: ['nombre', 'pin', 'admin', 'activo'] },
} as const;
type Hoja = keyof typeof HOJAS;
const col = (i: number) => String.fromCharCode(65 + i);

export const sheets = () => google.sheets({ version: 'v4', auth: getAuth() });

// Lee una pestaña (la crea con encabezados si no existe).
export async function leer(h: Hoja): Promise<string[][]> {
  const { t, cols } = HOJAS[h];
  const s = sheets();
  const r = await s.spreadsheets.values.get({ spreadsheetId: ID, range: `'${t}'!A2:${col(cols.length - 1)}`, valueRenderOption: 'UNFORMATTED_VALUE' }).catch(() => null);
  if (r) return (r.data.values ?? []).map((f) => f.map((x) => (x == null ? '' : String(x))));
  await s.spreadsheets.batchUpdate({ spreadsheetId: ID, requestBody: { requests: [{ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }] } });
  await s.spreadsheets.values.update({ spreadsheetId: ID, range: `'${t}'!A1`, valueInputOption: 'RAW', requestBody: { values: [[...cols]] } });
  return [];
}
export async function agregar(h: Hoja, filas: (string | number)[][]) {
  if (!filas.length) return;
  await sheets().spreadsheets.values.append({ spreadsheetId: ID, range: `'${HOJAS[h].t}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: filas } });
}
// i = índice en el array de leer() (fila i+2 de la hoja)
export async function reemplazar(h: Hoja, i: number, fila: (string | number)[]) {
  const { t, cols } = HOJAS[h];
  await sheets().spreadsheets.values.update({ spreadsheetId: ID, range: `'${t}'!A${i + 2}:${col(cols.length - 1)}${i + 2}`, valueInputOption: 'RAW', requestBody: { values: [fila] } });
}

export type Item = { nombre: string; cant: number; precio: number; costo: number; pers: boolean; color?: string };
export type Pago = { fecha: string; monto: number; medio: string; nota?: string };
export type Pedido = {
  nro: number; creado: string; fecha: string; vendedor: string; cliente: string; items: Item[]; neto: number; iva: number; total: number;
  costo: number; entrega: string; direccion: string; fechaEntrega: string; estado: string; pagos: Pago[]; obs: string; origen: string;
  actualizado: string; conIva: boolean; anulado: boolean; pagado: number; saldo: number;
};
const j = <T,>(s: string, d: T): T => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
export const num = (x: unknown) => Math.round(Number(x) || 0);

export function aPedido(f: string[]): Pedido {
  const pagos = j<Pago[]>(f[14], []);
  const total = num(f[8]);
  const pagado = pagos.reduce((s, p) => s + num(p.monto), 0);
  return {
    nro: num(f[0]), creado: f[1], fecha: f[2], vendedor: f[3], cliente: f[4], items: j<Item[]>(f[5], []), neto: num(f[6]), iva: num(f[7]),
    total, costo: num(f[9]), entrega: f[10], direccion: f[11], fechaEntrega: f[12], estado: f[13] || 'Pendiente', pagos, obs: f[15],
    origen: f[16] || 'app', actualizado: f[17], conIva: f[18] !== 'NO', anulado: f[19] === 'SI', pagado, saldo: Math.max(0, total - pagado),
  };
}
export function dePedido(p: Omit<Pedido, 'pagado' | 'saldo'>): (string | number)[] {
  return [p.nro, p.creado, p.fecha, p.vendedor, p.cliente, JSON.stringify(p.items), p.neto, p.iva, p.total, p.costo, p.entrega, p.direccion,
    p.fechaEntrega, p.estado, JSON.stringify(p.pagos), p.obs, p.origen, p.actualizado, p.conIva ? 'SI' : 'NO', p.anulado ? 'SI' : 'NO'];
}

export const ahoraAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
export const hoyAR = () => ahoraAR().slice(0, 10);
