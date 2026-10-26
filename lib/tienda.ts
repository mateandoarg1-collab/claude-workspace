import { google } from 'googleapis';
import { getAuth } from './sheets';

// Rentabilidad de la tienda de Empretienda por venta y pauta por día (pestañas rentabilidad_tienda y
// rentabilidad_tienda_ads, las llena scripts/tienda-rentabilidad.mjs). Importes sin IVA.
const SPREADSHEET_ID = '1Cjh2fKaLQ0srGagMzI4nuJDcmRT386pKnkL7hty6hmI';

export type ProductoVenta = { id: string; n: string; v: string; q: number; p: number };
export type VentaTienda = {
  fecha: string; order_id: string; numero: string; canal: 'online' | 'local'; pago: string; envio: string; cp: string;
  provincia: string; ciudad: string; unidades: number; venta: number; descuentos: number; envio_cobrado: number;
  comision: number; envio_tienda: number; impuestos: number; costo: number; packaging: number; neto: number;
  sin_costo: number; sin_comision: number; cuotas: number | null; creada: string; productos: ProductoVenta[];
  deb_cred: number; facturada: boolean;
};

export async function getRentabilidadTienda() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges: [`'rentabilidad_tienda'!A1:Z`, `'rentabilidad_tienda_ads'!A1:E`, `'emp_productos'!A2:E`],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const [v, a, prods] = res.data.valueRanges ?? [];
  const [enc, ...filas] = v?.values ?? [];
  const col = Object.fromEntries((enc ?? []).map((k, i) => [String(k), i]));
  const num = (r: unknown[], k: string) => Number(r[col[k]]) || 0;
  const str = (r: unknown[], k: string) => (col[k] == null ? '' : String(r[col[k]] ?? ''));
  const productos = (r: unknown[]): ProductoVenta[] => {
    try {
      return JSON.parse(str(r, 'productos') || '[]');
    } catch {
      return [];
    }
  };
  return {
    actualizado: String(enc?.at(-1) ?? ''),
    ventas: filas.map((r): VentaTienda => ({
      fecha: str(r, 'fecha'), order_id: str(r, 'order_id'), numero: str(r, 'numero'), canal: str(r, 'canal') === 'local' ? 'local' : 'online',
      pago: str(r, 'pago'), envio: str(r, 'envio'), cp: str(r, 'cp'), provincia: str(r, 'provincia'), ciudad: str(r, 'ciudad'),
      unidades: num(r, 'unidades'), venta: num(r, 'venta'), descuentos: num(r, 'descuentos'), envio_cobrado: num(r, 'envio_cobrado'),
      comision: num(r, 'comision'), envio_tienda: num(r, 'envio_tienda'), impuestos: num(r, 'impuestos'), costo: num(r, 'costo'),
      packaging: num(r, 'packaging'), neto: num(r, 'neto'), sin_costo: num(r, 'sin_costo'), sin_comision: num(r, 'sin_comision'),
      cuotas: str(r, 'cuotas') ? num(r, 'cuotas') : null, creada: str(r, 'creada'), productos: productos(r),
      deb_cred: num(r, 'deb_cred'), facturada: str(r, 'facturada') === '1',
    })),
    ads: (a?.values ?? []).slice(1).map((r) => ({ fecha: String(r[0]), meta: Number(r[1]) || 0, google: Number(r[2]) || 0, total: Number(r[3]) || 0 })),
    // Foto y link de cada producto de la tienda (pestaña emp_productos: id, nombre, link, desactivado, imagen).
    fotos: new Map((prods?.values ?? []).map((r) => [String(r[0]), { foto: String(r[4] ?? '') || null, link: String(r[2] ?? '') || null }])),
  };
}
