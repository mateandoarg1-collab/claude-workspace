import { getVencimientos } from '@/lib/vencimientos';

// Vencimientos de los mails de «Mateando Datos» para /vencimientos (ver lib/vencimientos.ts).
export async function GET() {
  try {
    return Response.json(await getVencimientos());
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
