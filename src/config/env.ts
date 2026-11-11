import { z } from 'zod';

// Falla al arrancar si falta algo: sin NEXT_PUBLIC_APP_URL correcto el enlace del correo cae donde no hay /auth/callback.
const esquema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  LIMITE_PIMIENTA: z.string().min(16),
});

export type Env = z.infer<typeof esquema>;

let cache: Env | null = null;

export function env(): Env {
  if (cache) return cache;
  const r = esquema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    LIMITE_PIMIENTA: process.env.LIMITE_PIMIENTA,
  });
  if (!r.success) {
    const campos = r.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuracion de entorno invalida (${campos}). Ejecuta: node scripts/entorno/generar-env-local.mjs`);
  }
  cache = r.data;
  return cache;
}

/** URL publica de la app, sin barra final: donde debe aterrizar /auth/callback. */
export function appUrl(): string {
  return env().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}
