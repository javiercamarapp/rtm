// Raiz de composicion de Next 16 (antes middleware). Delgada a proposito: la logica vive en infra/supabase/proxy.ts.
import type { NextRequest } from 'next/server';
import { actualizarSesion } from '@/infra/supabase/proxy';

export async function proxy(req: NextRequest) {
  return actualizarSesion(req);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)'],
};
