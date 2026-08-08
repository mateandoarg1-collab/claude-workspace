export const EMPRETIENDA_STORAGE_KEY = 'mateando-empretienda-manual';

export type EmpretiendaManual = {
  totalMonto: string;
  totalCant: string;
  localMonto: string;
  localCant: string;
  updatedAt: string;
};

export function emptyEmpretiendaManual(): EmpretiendaManual {
  return { totalMonto: '', totalCant: '', localMonto: '', localCant: '', updatedAt: '' };
}

export function loadEmpretiendaManual(): EmpretiendaManual {
  const saved = localStorage.getItem(EMPRETIENDA_STORAGE_KEY);
  return saved ? JSON.parse(saved) : emptyEmpretiendaManual();
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.')) || 0;

export function splitEmpretienda(m: EmpretiendaManual) {
  const totalMonto = num(m.totalMonto);
  const totalCant = num(m.totalCant);
  const localMonto = num(m.localMonto);
  const localCant = num(m.localCant);
  return {
    onlineMonto: Math.max(0, totalMonto - localMonto),
    onlineCant: Math.max(0, totalCant - localCant),
    localMonto,
    localCant,
  };
}
