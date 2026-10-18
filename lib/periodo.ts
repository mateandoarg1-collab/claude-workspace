// Períodos del selector de /canales (hora Argentina): hoy, ayer, semana (últimos 7 días con hoy) y mes en curso.
export type Periodo = 'hoy' | 'ayer' | 'semana' | 'mes';

export function parsePeriodo(v: string | null): Periodo {
  return v === 'hoy' || v === 'ayer' || v === 'semana' ? v : 'mes';
}

// Día AR (YYYY-MM-DD) en que arranca el período.
export function desdeAR(p: Periodo, now = new Date()): string {
  const ar = new Date(now.getTime() - 3 * 3600 * 1000);
  if (p === 'ayer') ar.setUTCDate(ar.getUTCDate() - 1);
  if (p === 'semana') ar.setUTCDate(ar.getUTCDate() - 6);
  if (p === 'mes') ar.setUTCDate(1);
  return ar.toISOString().slice(0, 10);
}

// Último día AR (YYYY-MM-DD, inclusive) del período: ayer termina ayer; el resto, hoy.
export const hastaAR = (p: Periodo, now = new Date()) => desdeAR(p === 'ayer' ? 'ayer' : 'hoy', now);

// Medianoche AR de ese día, como Date.
export const inicioAR = (dia: string) => new Date(`${dia}T00:00:00-03:00`);

// Fin (exclusivo) del período como Date: medianoche de hoy para ayer; ahora para el resto.
export const finAR = (p: Periodo, now = new Date()) => (p === 'ayer' ? inicioAR(desdeAR('hoy', now)) : now);
