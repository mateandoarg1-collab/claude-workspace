import { conCache } from '@/lib/cache';
import { internacional } from '@/lib/internacional';

export const maxDuration = 60;

async function obtener() {
  try {
    return Response.json(await internacional());
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const GET = conCache(obtener, 900);
