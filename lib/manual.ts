export type EmpretiendaManual = {
  gocuotasMonto: number;
  gocuotasCant: number;
  updatedAt: string;
  metricas?: {
    mes: string;
    totalMonto: number;
    totalCant: number;
    acordarMonto: number;
    acordarCant: number;
    updatedAt: string;
  } | null;
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
