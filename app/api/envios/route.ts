import { conCache } from '@/lib/cache';
import { getEnvios } from '@/lib/envios';

export const maxDuration = 30;

// Órdenes de Empretienda de los últimos 3 días con el estado del paquete en OCA (ver lib/envios.ts). 5 min en la CDN.
async function obtener() {
  try {
    const ordenes = await getEnvios(3);
    return Response.json({ ordenes, actualizado: new Date().toISOString() });
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = conCache(obtener, 300);
