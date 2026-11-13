// Limite de intentos sobre Postgres (sin servicios externos de cache). La clave nunca lleva el correo ni la IP en claro:
// es un HMAC-SHA256 con una pimienta del servidor.
// Desde F1 NO usa la llave anon: se conecta con el rol de base `servidor` (sin BYPASSRLS, solo EXECUTE sobre esta funcion),
// asi que `anon` ya no puede ejecutar nada en la base. Plan B documentado en docs/F1-informe.md si el pooler lo estorba.
// FALLA CERRADO (decision del dueno, 13-nov): si no puede consultar o registrar el intento, lanza `LimitadorNoDisponible` y el acceso se rechaza
// con la respuesta generica. Procedimiento de emergencia: docs/ACCESO-LIMITADOR-EMERGENCIA.md.
import { createHmac } from 'node:crypto';
import pg from 'pg';
import { LimitadorNoDisponible, type LimitadorIntentos, type TipoClave, type Tope } from '@/aplicacion/acceso/puertos';
import { env } from '@/config/env';

export function claveDeLimite(pimienta: string, tipo: TipoClave, valor: string): string {
  const huella = createHmac('sha256', pimienta).update(`${tipo}:${valor}`, 'utf8').digest('hex').slice(0, 32);
  return `${tipo}:${huella}`;
}

// Un arranque en frio contra el pooler puede tardar mas de un intento: UN solo reintento acotado. Cada intento tiene su propio tope de 1.4 s
// (conexion y consulta) y entre ambos hay 100 ms: el peor caso es 2.9 s en total (<= 3 s) y despues se FALLA CERRADO igual que antes.
// El segundo intento puede contar dos veces un mismo acceso si el primero llego a la base y solo se perdio la respuesta: el error va hacia el lado
// restrictivo (cuenta de mas), nunca hacia dejar pasar.
export const TOPE_INTENTO_MS = 1_400;
export const PAUSA_REINTENTO_MS = 100;
export const TOPE_TOTAL_MS = 2 * TOPE_INTENTO_MS + PAUSA_REINTENTO_MS;

let pool: pg.Pool | null = null;
function obtenerPool(url: string): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: TOPE_INTENTO_MS, query_timeout: TOPE_INTENTO_MS });
    // Un cliente inactivo que se cae no debe tumbar el proceso: el siguiente intento reabre y, si no puede, falla cerrado.
    pool.on('error', () => undefined);
  }
  return pool;
}

export function limitadorPostgres(): LimitadorIntentos {
  const e = env();
  return {
    async excede(tipo, valor, tope: Tope) {
      const clave = claveDeLimite(e.LIMITE_PIMIENTA, tipo, tipo === 'correo' ? valor.trim().toLowerCase() : valor);
      try {
        // Consulta simple con parametros: compatible con el pooler en modo transaccion (sin sentencias preparadas con nombre).
        const consultar = () => obtenerPool(e.SERVIDOR_DATABASE_URL).query('select seguridad.registrar_intento_login($1::text, $2::int) as n', [clave, tope.ventanaSeg]);
        let r;
        try {
          r = await consultar();
        } catch {
          await new Promise<void>((ok) => setTimeout(ok, PAUSA_REINTENTO_MS));
          r = await consultar(); // si tambien falla, el catch de abajo lo vuelve LimitadorNoDisponible (fail-closed)
        }
        const n = Number(r.rows[0]?.n);
        if (!Number.isFinite(n)) throw new LimitadorNoDisponible('RESPUESTA_INVALIDA');
        return n > tope.limite;
      } catch (e) {
        if (e instanceof LimitadorNoDisponible) throw e;
        // Solo el codigo tecnico (ECONNREFUSED, 28000, 57014...): nunca el mensaje, que podria traer host o usuario.
        const codigo = (e as { code?: unknown } | null)?.code;
        throw new LimitadorNoDisponible(typeof codigo === 'string' && /^[A-Za-z0-9_]{2,24}$/.test(codigo) ? codigo : 'DESCONOCIDO');
      }
    },
  };
}
