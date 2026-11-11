// Limite de intentos sobre Postgres (sin servicios externos de cache). La clave nunca lleva el correo ni la IP en claro:
// es un HMAC-SHA256 con una pimienta del servidor, asi que quien tenga la llave publica de la API no puede adivinar
// ni agotar el contador de otra persona.
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { LimitadorIntentos, TipoClave, Tope } from '@/aplicacion/acceso/puertos';
import { env } from '@/config/env';

export function claveDeLimite(pimienta: string, tipo: TipoClave, valor: string): string {
  const huella = createHmac('sha256', pimienta).update(`${tipo}:${valor}`, 'utf8').digest('hex').slice(0, 32);
  return `${tipo}:${huella}`;
}

export function limitadorPostgres(): LimitadorIntentos {
  const e = env();
  const cliente = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: 'api' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async excede(tipo, valor, tope: Tope) {
      const clave = claveDeLimite(e.LIMITE_PIMIENTA, tipo, tipo === 'correo' ? valor.trim().toLowerCase() : valor);
      const { data, error } = await cliente.rpc('registrar_intento_login', { p_clave: clave, p_ventana_seg: tope.ventanaSeg });
      // Falla ABIERTO: /login es la unica via de entrada y, si la base no responde, tampoco se puede enviar el enlace.
      if (error || typeof data !== 'number') return false;
      return data > tope.limite;
    },
  };
}
