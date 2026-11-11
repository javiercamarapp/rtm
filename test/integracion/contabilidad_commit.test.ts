// Integracion contra la base LOCAL: el asiento nace al COMMIT de la transaccion de la web, con el rol authenticated (sin acceso directo al esquema
// de contabilidad). pgTAP corre en una sola transaccion que nunca confirma: no puede probar los triggers diferidos. Aqui cada escritura confirma de verdad.
// Deja asientos de solo insercion: `npm run verificar` reinicia la base antes de las pruebas de pantallas.
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { altaUsuario, correoUnico, estado } from '../e2e/ayudas';

describe('asientos al confirmar la transaccion de la web', () => {
  const c = new pg.Client({ connectionString: estado().DB_URL });
  const sufijo = Date.now().toString(36);
  let uid = '';

  afterAll(async () => {
    await c.end();
  });

  async function comoSocio<T>(sql: string, args: unknown[]): Promise<T[]> {
    await c.query('begin');
    try {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
      const r = await c.query(sql, args);
      await c.query('commit');
      return r.rows as T[];
    } catch (e) {
      await c.query('rollback');
      throw e;
    }
  }

  it('una aportacion, un gasto y un pago sin identificar escritos por la web dejan su asiento cuadrado', async () => {
    await c.connect();
    uid = await altaUsuario({ correo: correoUnico('commit'), socio: 'Angelo' });
    const antes = Number((await c.query('select count(*) as n from contabilidad.asiento')).rows[0].n);
    await comoSocio('select api.registrar_aportacion($1, $2, $3, $4, $5)', [`web:${crypto.randomUUID()}`, 'Angelo', 12345, `Capital integracion ${sufijo}`, 'capital']);
    await comoSocio('select api.registrar_gasto_socio($1, $2, $3, $4, $5)', [`web:${crypto.randomUUID()}`, 'Javier', 6789, `uber integracion ${sufijo}`, 'variable']);
    await comoSocio('select api.registrar_pago($1, $2, $3)', [`web:${crypto.randomUUID()}`, 'Angelo', 4321]);
    const despues = Number((await c.query('select count(*) as n from contabilidad.asiento')).rows[0].n);
    expect(despues - antes).toBe(3);
    const mal = await c.query('select count(*) as n from (select asiento_id from contabilidad.asiento_linea group by asiento_id having sum(debe_cent) <> sum(haber_cent)) q');
    expect(Number(mal.rows[0].n)).toBe(0);
    const pago = await c.query("select l.cuenta, l.debe_cent::text as debe, l.haber_cent::text as haber from contabilidad.asiento_linea l join contabilidad.asiento a on a.id = l.asiento_id join operacion.evento e on e.id = a.evento_id where e.tipo = 'pago_cliente' order by a.id desc, l.n limit 2");
    expect(pago.rows).toEqual([{ cuenta: '1150', debe: '4321', haber: '0' }, { cuenta: '2420', debe: '0', haber: '4321' }]);
    expect((await c.query('select contabilidad.verificar_cadena() as roto')).rows[0].roto).toBeNull();
  });

  it('un evento que no puede cuadrar tumba la transaccion completa: no queda el hecho sin su asiento', async () => {
    const antesEv = Number((await c.query('select count(*) as n from operacion.evento')).rows[0].n);
    await c.query('begin');
    await c.query('set constraints all immediate');
    await expect(c.query("insert into contabilidad.asiento_linea (asiento_id, n, cuenta, debe_cent, haber_cent) values ((select max(id) from contabilidad.asiento), 98, '1101', 5, 0)")).rejects.toThrow(/descuadrado/);
    await c.query('rollback');
    const despuesEv = Number((await c.query('select count(*) as n from operacion.evento')).rows[0].n);
    expect(despuesEv).toBe(antesEv);
  });
});
