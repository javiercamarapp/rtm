// Limite de intentos sobre Postgres (sin servicios externos de cache). La clave nunca lleva el correo ni la IP en claro:
// es un HMAC-SHA256 con una pimienta del servidor.
// Desde F1 NO usa la llave anon: se conecta con el rol de base `servidor` (sin BYPASSRLS, solo EXECUTE sobre esta funcion),
// asi que `anon` ya no puede ejecutar nada en la base. Plan B documentado en docs/F1-informe.md si el pooler lo estorba.
import { createHmac } from 'node:crypto';
import pg from 'pg';
import type { LimitadorIntentos, TipoClave, Tope } from '@/aplicacion/acceso/puertos';
import { env } from '@/config/env';

export function claveDeLimite(pimienta: string, tipo: TipoClave, valor: string): string {
  const huella = createHmac('sha256', pimienta).update(`${tipo}:${valor}`, 'utf8').digest('hex').slice(0, 32);
  return `${tipo}:${huella}`;
}

let pool: pg.Pool | null = null;
function obtenerPool(url: string): pg.Pool {
  pool ??= new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 3_000 });
  return pool;
}

export function limitadorPostgres(): LimitadorIntentos {
  const e = env();
  return {
    async excede(tipo, valor, tope: Tope) {
      const clave = claveDeLimite(e.LIMITE_PIMIENTA, tipo, tipo === 'correo' ? valor.trim().toLowerCase() : valor);
      try {
        // Consulta simple con parametros: compatible con el pooler en modo transaccion (sin sentencias preparadas con nombre).
        const r = await obtenerPool(e.SERVIDOR_DATABASE_URL).query('select seguridad.registrar_intento_login($1::text, $2::int) as n', [clave, tope.ventanaSeg]);
        const n = Number(r.rows[0]?.n);
        // Falla ABIERTO: /login es la unica via de entrada y, si la base no responde, tampoco se puede enviar el enlace.
        if (!Number.isFinite(n)) return false;
        return n > tope.limite;
      } catch {
        return false;
      }
    },
  };
}
