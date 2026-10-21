export type EmpretiendaManual = {
  gocuotasMonto: number;
  gocuotasCant: number;
  updatedAt: string;
  metricas?: {
    periodo: 'hoy' | 'ayer' | 'semana' | 'mes';
    desde: string;
    totalMonto: number;
    totalCant: number;
    acordarMonto: number;
    acordarCant: number;
    updatedAt: string;
  }[];
  cmv?: {
    periodo: string;
    onlineFact: number;
    onlineCmv: number;
    onlinePack: number;
    localFact: number;
    localCmv: number;
    localPack: number;
    updatedAt: string;
    onlineTransf: number | null;
  }[];
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
