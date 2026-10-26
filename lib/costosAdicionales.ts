// Costos adicionales (fuera de la venta) de Mercado Libre, la tienda online y el local: tipos y cuentas que usan tanto
// el servidor como la página.
export type BaseVariable = 'venta' | 'venta_con_iva_menos_ads' | 'pedido';
export type Canal = 'meli' | 'tienda' | 'local';
export const CANALES: Record<Canal, string> = { meli: 'Mercado Libre', tienda: 'Tienda online', local: 'Local' };
export type CostoAdicional = {
  nombre: string; tipo: 'fijo' | 'variable'; monto: number; base: BaseVariable | ''; desde: string; hasta: string; canal: Canal;
};

const IVA = 1.21;

// Cuánto suma un costo adicional en un día. Fijo: el monto mensual repartido en 30 días. Variable: % de la base,
// o $ por venta. `hasta` es el último día inclusive.
export function adicionalDelDia(c: CostoAdicional, fecha: string, dia: { venta: number; pauta: number; ordenes: number }) {
  if ((c.desde && fecha < c.desde) || (c.hasta && fecha > c.hasta)) return 0;
  if (c.tipo === 'fijo') return c.monto / 30;
  if (c.base === 'pedido') return c.monto * dia.ordenes;
  if (c.base === 'venta_con_iva_menos_ads') return ((dia.venta * IVA - dia.pauta) * c.monto) / 100;
  return (dia.venta * c.monto) / 100;
}

export const BASES: Record<BaseVariable, string> = {
  venta: '% de la facturación sin IVA',
  venta_con_iva_menos_ads: '% de (venta con IVA − publicidad ML Ads)',
  pedido: '$ por venta',
};

// "2% de (venta con IVA − publicidad ML Ads)", "$101.035 por mes"…
export function describirAdicional(c: CostoAdicional) {
  const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
  if (c.tipo === 'fijo') return `${pesos(c.monto)} por mes`;
  if (c.base === 'pedido') return `${pesos(c.monto)} por venta`;
  return `${c.monto.toLocaleString('es-AR')}${BASES[c.base || 'venta']}`;
}
