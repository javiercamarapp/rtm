// Cliente de Supabase con las cookies de la peticion (llave publica; la sesion del usuario manda). Nunca la llave de servicio.
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/config/env';

export async function crearClienteServidor(cabeceras?: Record<string, string>) {
  const jar = await cookies();
  const e = env();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: 'api' },
    ...(cabeceras && Object.keys(cabeceras).length ? { global: { headers: cabeceras } } : {}),
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) jar.set(name, value, options);
        } catch {
          // Desde un Server Component las cookies son de solo lectura: el proxy refresca la sesion.
        }
      },
    },
  });
}
