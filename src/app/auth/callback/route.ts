// Supabase redirige aqui con ?code= tras el enlace magico. La logica vive en la capa de aplicacion (completar_acceso.ts):
// canjear el codigo, exigir cuenta ACTIVA con rol de la tabla y decidir a donde ir. Aqui solo se vuelve absoluta la ruta propia.
import { NextResponse, type NextRequest } from 'next/server';
import { ipDeSolicitud, procesarCallback } from '@/composicion/acceso';
import { appUrl } from '@/config/env';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { destino } = await procesarCallback({
    code: req.nextUrl.searchParams.get('code'),
    next: req.nextUrl.searchParams.get('next'),
    errorCode: req.nextUrl.searchParams.get('error_code'),
    ip: ipDeSolicitud(req.headers),
  });
  // El redirect sale hacia el origen PUBLICO configurado (nunca el que diga la peticion): la cookie de sesion debe viajar con el.
  return NextResponse.redirect(new URL(destino, appUrl()));
}
