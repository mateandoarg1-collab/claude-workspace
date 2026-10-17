// Períodos del selector de /canales (hora Argentina): hoy, semana (últimos 7 días con hoy) y mes en curso.
export type Periodo = 'hoy' | 'semana' | 'mes';

export function parsePeriodo(v: string | null): Periodo {
  return v === 'hoy' || v === 'semana' ? v : 'mes';
}

// Día AR (YYYY-MM-DD) en que arranca el período.
export function desdeAR(p: Periodo, now = new Date()): string {
  const ar = new Date(now.getTime() - 3 * 3600 * 1000);
  if (p === 'semana') ar.setUTCDate(ar.getUTCDate() - 6);
  if (p === 'mes') ar.setUTCDate(1);
  return ar.toISOString().slice(0, 10);
}

// Medianoche AR de ese día, como Date.
export const inicioAR = (dia: string) => new Date(`${dia}T00:00:00-03:00`);
