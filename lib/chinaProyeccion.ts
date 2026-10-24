// Proyección de stock de los productos chinos. Sin dependencias de servidor: la usan la API (/api/china) y la página
// (/china), que recalcula al tocar los botones de "boost de demanda" y los selectores del pedido.

export const LEAD_TIME = 90; // días desde que se hace el pedido hasta que llega el container
export const SAFETY = 30; // días de colchón por demoras de aduana/flete
export const HORIZONTE = 135; // días que muestra el gráfico
export const COBERTURA = 365; // por defecto, el pedido sugerido cubre un año desde que llega
export const CRECIMIENTO = 0; // por mes (la página permite elegir +3%)
export const UNIDADES_CAJA: Record<string, number> = { 'Mate Acero 236': 50 }; // el resto: 25 por caja

const fecha = (s: string) => new Date(`${s}T12:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const sumarDias = (dia: string, n: number) => iso(new Date(fecha(dia).getTime() + n * 864e5));

function enesimoDia(anio: number, mes: number, diaSemana: number, n: number) {
  const d = new Date(Date.UTC(anio, mes, 1, 12));
  while (d.getUTCDay() !== diaSemana) d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() + 7 * (n - 1);
}

// Fechas fuertes y cuánto se vende ese día respecto de un día normal. Los valores de acá salen del historial de
// órdenes de MeLi 2025-26 de toda la cuenta; /api/china los reemplaza por los medidos con las ventas de los propios
// productos chinos a medida que cada fecha pasa (ver aprenderFactores en lib/china.ts).
export const FACTORES = {
  madre: 1.19, // 11 días antes del Día de la Madre (3er domingo de octubre) y ese día
  cyber: 2.5, // CyberMonday: primer lunes de noviembre + 2 días
  empresariales: 1.25, // regalos de fin de año: 15/11 al 20/12 (se suma a Navidad)
  navidad: 1.7, // 1 al 24 de diciembre
  fin_de_anio: 0.65, // 25 al 31 de diciembre
  hotsale: 4.4, // segundo lunes de mayo + 2 días
  mayo: 2, // resto de mayo después del Hot Sale
  padre: 2.35, // junio hasta el Día del Padre (3er domingo)
} as const;
export type Evento = keyof typeof FACTORES;
export type Ajustes = Partial<Record<Evento, number>>;
export const NOMBRE_EVENTO: Record<Evento, string> = {
  madre: 'Día de la Madre', cyber: 'CyberMonday', empresariales: 'Regalos empresariales', navidad: 'Navidad',
  fin_de_anio: 'Fin de año', hotsale: 'Hot Sale', mayo: 'Mayo post Hot Sale', padre: 'Día del Padre',
};

export function eventosDel(dia: string): Evento[] {
  const d = fecha(dia);
  const a = d.getUTCFullYear(), m = d.getUTCMonth(), n = d.getUTCDate();
  const ev: Evento[] = [];
  if (m === 9) { const madre = enesimoDia(a, 9, 0, 3); if (n >= madre - 11 && n <= madre) ev.push('madre'); }
  if (m === 10) { const cyber = enesimoDia(a, 10, 1, 1); if (n >= cyber && n <= cyber + 2) ev.push('cyber'); }
  if ((m === 10 && n >= 15) || (m === 11 && n <= 20)) ev.push('empresariales');
  if (m === 11) ev.push(n <= 24 ? 'navidad' : 'fin_de_anio');
  if (m === 4) { const hot = enesimoDia(a, 4, 1, 2); if (n >= hot && n <= hot + 2) ev.push('hotsale'); else if (n > hot + 2) ev.push('mayo'); }
  if (m === 5 && n <= enesimoDia(a, 5, 0, 3)) ev.push('padre');
  return ev;
}

export function factor(dia: string, ajustes: Ajustes = {}): number {
  return eventosDel(dia).reduce((f, e) => f * (ajustes[e] ?? FACTORES[e]), 1);
}

// mayoristaDia: venta mayorista promedio; no mueve el quiebre (pedidos sueltos), solo se suma al pedido sugerido.
export type Opciones = { boost?: number; cobertura?: number; crecimiento?: number; ajustes?: Ajustes; mayoristaDia?: number };

// Venta esperada del día `i` contado desde hoy, con un ritmo base (día normal), el boost y el crecimiento elegidos.
const ventaDia = (base: number, hoy: string, i: number, boost: number, crecimiento: number, ajustes: Ajustes) =>
  base * (1 + boost) * factor(sumarDias(hoy, i), ajustes) * (1 + crecimiento) ** (i / 30.4);

export type Proyeccion = {
  curva: number[]; // stock al final de cada día, de hoy a HORIZONTE
  agota: string | null; // día en que llega a 0 (null: más de 3 años)
  dias: number | null;
  sugerido: number; // unidades a pedir hoy para cubrir `cobertura` días desde que llega
};

export function proyectar(stock: number, base: number, hoy: string, op: Opciones = {}): Proyeccion {
  const { boost = 0, cobertura = COBERTURA, crecimiento = CRECIMIENTO, ajustes = {}, mayoristaDia = 0 } = op;
  const curva = [stock];
  let s = stock;
  let agota: string | null = stock <= 0 ? hoy : null;
  let dias: number | null = stock <= 0 ? 0 : null;
  let demanda = 0;
  for (let i = 1; i <= 1095; i++) {
    const v = ventaDia(base, hoy, i, boost, crecimiento, ajustes);
    if (i <= LEAD_TIME + cobertura) demanda += v + mayoristaDia;
    s -= v;
    if (i <= HORIZONTE) curva.push(Math.max(0, s));
    if (agota == null && s <= 0) { agota = sumarDias(hoy, i); dias = i; }
    if (agota != null && i >= Math.max(HORIZONTE, LEAD_TIME + cobertura)) break;
  }
  if (base <= 0) { agota = stock <= 0 ? hoy : null; dias = stock <= 0 ? 0 : null; }
  return { curva, agota, dias, sugerido: Math.max(0, Math.round(demanda - stock)) };
}

export function estado(dias: number | null): 'critico' | 'atencion' | 'ok' {
  if (dias != null && dias <= LEAD_TIME) return 'critico'; // se agota antes de que llegue un pedido hecho hoy
  if (dias != null && dias <= LEAD_TIME + SAFETY + 30) return 'atencion';
  return 'ok';
}
