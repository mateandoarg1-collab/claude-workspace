export type EmpretiendaManual = {
  totalMonto: number;
  totalCant: number;
  localMonto: number;
  localCant: number;
  updatedAt: string;
};

export async function fetchEmpretiendaManual(): Promise<EmpretiendaManual> {
  const r = await fetch('/api/empretienda', { cache: 'no-store' });
  return r.json();
}

export async function saveEmpretiendaManual(data: Omit<EmpretiendaManual, 'updatedAt'>): Promise<EmpretiendaManual> {
  const r = await fetch('/api/empretienda', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return r.json();
}

export function splitEmpretienda(m: EmpretiendaManual) {
  return {
    onlineMonto: Math.max(0, m.totalMonto - m.localMonto),
    onlineCant: Math.max(0, m.totalCant - m.localCant),
    localMonto: m.localMonto,
    localCant: m.localCant,
  };
}
