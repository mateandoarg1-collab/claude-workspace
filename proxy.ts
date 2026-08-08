// Auth desactivada a pedido: el dashboard es de acceso libre por link.
// La lógica de password + cookie firmada queda en app/api/auth y app/login
// por si se quiere reactivar (volver a agregar el chequeo acá).

import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
