// Proyección de stock de los productos chinos. Sin dependencias de servidor: la usan la API (/api/china) y la página
// (/china), que recalcula al tocar los botones de "boost de demanda".

export const LEAD_TIME = 90; // días desde que se hace el pedido hasta que llega el container
export const SAFETY = 30; // días de colchón por demoras de aduana/flete
export const HORIZONTE = 135; // días que muestra el gráfico
export const COBERTURA = 365; // el pedido sugerido cubre un año desde que llega
export const CRECIMIENTO = 0.03; // por mes
export const UNIDADES_CAJA: Record<string, number> = { 'Mate Acero 236': 50 }; // el resto: 25 por caja

const fecha = (s: string) => new Date(`${s}T12:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const sumarDias = (dia: string, n: number) => iso(new Date(fecha(dia).getTime() + n * 864e5));

function enesimoDia(anio: number, mes: number, diaSemana: number, n: number) {
  const d = new Date(Date.UTC(anio, mes, 1, 12));
  while (d.getUTCDay() !== diaSemana) d.setUTCDate(d.getUTCDate() + 1);
  return d.getUTCDate() + 7 * (n - 1);
}

// Cuánto se vende un día respecto de un día normal. Sale del historial de órdenes de MeLi 2025-26.
export function factor(dia: string): number {
  const d = fecha(dia);
  const a = d.getUTCFullYear(), m = d.getUTCMonth(), n = d.getUTCDate();
  let f = 1;
  if (m === 9) { const madre = enesimoDia(a, 9, 0, 3); if (n >= madre - 8 && n <= madre) f = 1.19; } // Día de la Madre
  if (m === 10) { const cyber = enesimoDia(a, 10, 1, 1); if (n >= cyber && n <= cyber + 2) f = 2.5; } // CyberMonday
  if (m === 11) f = n <= 24 ? 1.7 : 0.65; // Navidad
  if ((m === 10 && n >= 15) || (m === 11 && n <= 20)) f *= 1.25; // regalos empresariales
  if (m === 4) { const hot = enesimoDia(a, 4, 1, 2); if (n >= hot && n <= hot + 2) f = 4.4; else if (n > hot + 2) f = 2; } // Hot Sale
  if (m === 5 && n <= enesimoDia(a, 5, 0, 3)) f = 2.35; // hasta el Día del Padre
  return f;
}

// Venta esperada del día `i` contado desde hoy, con un ritmo base (día normal) y el boost elegido.
const ventaDia = (base: number, hoy: string, i: number, boost: number) =>
  base * (1 + boost) * factor(sumarDias(hoy, i)) * (1 + CRECIMIENTO) ** (i / 30.4);

export type Proyeccion = {
  curva: number[]; // stock al final de cada día, de hoy a HORIZONTE
  agota: string | null; // día en que llega a 0 (null: más de 3 años)
  dias: number | null;
  sugerido: number; // unidades a pedir hoy para cubrir COBERTURA días desde que llega
};

export function proyectar(stock: number, base: number, hoy: string, boost = 0): Proyeccion {
  const curva = [stock];
  let s = stock;
  let agota: string | null = stock <= 0 ? hoy : null;
  let dias: number | null = stock <= 0 ? 0 : null;
  let demanda = 0;
  for (let i = 1; i <= 1095; i++) {
    const v = ventaDia(base, hoy, i, boost);
    if (i <= LEAD_TIME + COBERTURA) demanda += v;
    s -= v;
    if (i <= HORIZONTE) curva.push(Math.max(0, s));
    if (agota == null && s <= 0) { agota = sumarDias(hoy, i); dias = i; }
    if (agota != null && i >= Math.max(HORIZONTE, LEAD_TIME + COBERTURA)) break;
  }
  if (base <= 0) { agota = stock <= 0 ? hoy : null; dias = stock <= 0 ? 0 : null; }
  return { curva, agota, dias, sugerido: Math.max(0, Math.round(demanda - stock)) };
}

export function estado(dias: number | null): 'critico' | 'atencion' | 'ok' {
  if (dias != null && dias <= LEAD_TIME) return 'critico'; // se agota antes de que llegue un pedido hecho hoy
  if (dias != null && dias <= LEAD_TIME + SAFETY + 30) return 'atencion';
  return 'ok';
}
