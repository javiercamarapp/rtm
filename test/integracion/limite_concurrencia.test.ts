// Integracion contra la base LOCAL: el limite de intentos es atomico bajo concurrencia real (varias sesiones a la vez).
// pgTAP corre en una sola transaccion y no puede probarlo. Se ejecuta en `npm run verificar` tras levantar Supabase.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { estado } from '../e2e/ayudas';

const CLAVE_BASE = `ip:conc${Date.now().toString(36)}`;

describe('seguridad.registrar_intento_login bajo concurrencia', () => {
  const clientes: pg.Client[] = [];
  const claves: string[] = [];

  afterAll(async () => {
    const c = clientes[0];
    if (c) await c.query('delete from seguridad.limite_intento_evento where clave = any($1::text[])', [claves]);
    await Promise.all(clientes.map((x) => x.end()));
  });

  async function sesiones(n: number): Promise<pg.Client[]> {
    const cs = Array.from({ length: n }, () => new pg.Client({ connectionString: estado().DB_URL }));
    await Promise.all(cs.map((c) => c.connect()));
    clientes.push(...cs);
    return cs;
  }

  it('40 llamadas simultaneas de 40 sesiones devuelven exactamente 1..40: ninguna cuenta la misma foto', async () => {
    const clave = `${CLAVE_BASE}aaaa`;
    claves.push(clave);
    const cs = await sesiones(40);
    const r = await Promise.all(cs.map((c) => c.query<{ n: number }>('select seguridad.registrar_intento_login($1::text, $2::int) as n', [clave, 600])));
    const ns = r.map((x) => Number(x.rows[0]?.n)).sort((a, b) => a - b);
    expect(ns).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    // Con tope 3: exactamente 3 pasan, nadie extra.
    expect(ns.filter((n) => n <= 3)).toHaveLength(3);
  });

  it('claves distintas en paralelo no se bloquean ni se mezclan', async () => {
    const a = `${CLAVE_BASE}bbbb`;
    const b = `${CLAVE_BASE}cccc`;
    claves.push(a, b);
    const cs = await sesiones(20);
    const r = await Promise.all(cs.map((c, i) => c.query<{ n: number }>('select seguridad.registrar_intento_login($1::text, 600) as n', [i % 2 === 0 ? a : b])));
    const porClave = (par: number) => r.filter((_, i) => i % 2 === par).map((x) => Number(x.rows[0]?.n)).sort((x, y) => x - y);
    expect(porClave(0)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(porClave(1)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });
});
