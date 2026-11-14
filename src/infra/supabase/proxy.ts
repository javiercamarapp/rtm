// Refresca la sesion en cada peticion (los Server Components no pueden escribir cookies) y manda al login a quien no la tiene.
// La autoridad sigue siendo el guarda del layout (rol y activo salen de la tabla); esto solo evita renderizar de mas.
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/config/env';
import { redireccionPorRol } from '@/dominio/acceso/ruta_segura';

const PUBLICAS = [/^\/login(?:\/|$)/, /^\/auth\//, /^\/api\/(?:health|salud)$/, /^\/api\/telegram\/webhook$/, /^\/api\/tareas\/[a-z0-9-]+$/, /^\/terminos$/, /^\/privacidad$/];

export async function actualizarSesion(req: NextRequest): Promise<NextResponse> {
  let respuesta = NextResponse.next({ request: req });
  const e = env();
  const sb = createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        for (const { name, value } of lista) req.cookies.set(name, value);
        respuesta = NextResponse.next({ request: req });
        for (const { name, value, options } of lista) respuesta.cookies.set(name, value, options);
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const ruta = req.nextUrl.pathname;
  if (!data.user && !PUBLICAS.some((r) => r.test(ruta))) {
    // Una ruta de API sin sesion no es una pagina: responde 401 en JSON en vez de redirigir a /login (un monitor leia el 307 como caida).
    if (ruta.startsWith('/api/')) return NextResponse.json({ ok: false, error: 'sin_sesion' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (ruta !== '/') url.searchParams.set('next', ruta + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  // Omar y bodega solo ven su zona: una URL ajena responde 307 a su inicio en vez de servir (o redirigir despues) otra pantalla. La autoridad sigue siendo el guarda de cada layout.
  if (data.user && !ruta.startsWith('/api/') && !PUBLICAS.some((r) => r.test(ruta))) {
    const { data: perfil } = await sb.schema('api').rpc('mi_sesion');
    const p = (perfil ?? null) as { rol?: string; activo?: boolean } | null;
    const destino = redireccionPorRol(p?.rol, p?.activo === true, ruta);
    if (destino !== null) {
      const url = req.nextUrl.clone();
      url.pathname = destino;
      url.search = '';
      const redir = NextResponse.redirect(url);
      for (const c of respuesta.cookies.getAll()) redir.cookies.set(c);
      return redir;
    }
  }
  return respuesta;
}
