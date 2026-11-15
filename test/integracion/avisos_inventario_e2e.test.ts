// E2E de los AVISOS DE INVENTARIO contra una base temporal con todas las migraciones. Transporte de Telegram FALSO: nada sale a la red. Todo dentro de UNA transaccion que se revierte.
// Recorrido: encender (un socio), evaluar en SQL, armar el digest con el reloj, mandar al grupo por el transporte falso, confirmar, no repetir; y /minimo por el adaptador real.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarRelojAvisos, ModuloInventarioBot, type TransporteGrupo } from '@/aplicacion/agente/avisos_inventario';
import { PuertoAvisosInventarioDb } from '@/infra/agente/avisos_inventario_postgres';
import type { Miembro } from '@/dominio/agente/tipos';
import type { Sql } from '@/infra/postgres/servidor';
import { estado } from '../e2e/ayudas';

const c = new pg.Client({ connectionString: process.env.RTM_DB_URL_INVENTARIO ?? estado().DB_URL });
let n = 0;
let cola: Promise<unknown> = Promise.resolve();
const sql: Sql = (t, p = []) => {
  const turno = cola.then(async () => {
    const sp = `s${n++}`;
    await c.query(`savepoint ${sp}`);
    try {
      const r = (await c.query(t, [...p])).rows as never;
      await c.query(`release savepoint ${sp}`);
      return r;
    } catch (e) {
      await c.query(`rollback to savepoint ${sp}`);
      throw e;
    }
  });
  cola = turno.catch(() => undefined);
  return turno as never;
};

const ANGELO: Miembro = { telegramUserId: 7_100_001, persona: 'angelo', rol: 'socio' };
const OMAR: Miembro = { telegramUserId: 7_100_003, persona: 'omar', rol: 'omar' };

class Falso implements TransporteGrupo {
  enviados: string[] = [];
  async aGrupo(texto: string): Promise<boolean> {
    this.enviados.push(texto);
    return true;
  }
}

beforeAll(async () => {
  await c.connect();
  await c.query('begin');
  await c.query("select set_config('rtm.canal', 'importacion', true)");
  await c.query("select agente.registrar_miembro(7100001, 'angelo')");
  await c.query("select agente.registrar_miembro(7100003, 'omar')");
  await c.query("select catalogo.asegurar_modelo('E2e Marca', 'E2e Nexa', 50000, 'ambas')");
  await c.query("select catalogo.asegurar_sku('E2e Nexa', 'Mango')");
  await c.query("select catalogo.fijar_costo('e2e:c', 'Isaac', 'E2e Nexa', 9000, negocio.hoy() - 30, 'prueba')");
  await c.query("select operacion.registrar_movimiento('e2e:m', 'E2e Nexa', 'Mango', 'bodega_omar', 'entrada_compra', 40, 360000, negocio.hoy() - 2)");
  const r = await c.query(`select operacion.crear_compra('e2e:oc', 'Isaac', '[{"modelo":"E2e Nexa","sabor":"Mango","pagadas":100}]'::jsonb) as j`);
  const id = Number((r.rows[0] as { j: { compra_id: string } }).j.compra_id);
  await c.query("select operacion.confirmar_compra('e2e:occ', $1)", [id]);
  await c.query('update operacion.compra set llegada_estimada = negocio.hoy() - 3 where id = $1', [id]);
});
afterAll(async () => {
  await c.query('rollback');
  await c.end();
});

describe('avisos de inventario de punta a punta (base temporal, transporte falso)', () => {
  it('nace apagado; un socio enciende; el reloj manda un solo mensaje y no lo repite', async () => {
    const puerto = new PuertoAvisosInventarioDb(sql);
    const modulo = new ModuloInventarioBot(puerto);
    const t = new Falso();
    const hoy = ((await sql<{ d: string }>("select to_char(negocio.hoy(), 'YYYY-MM-DD') as d"))[0]!).d;
    const diez = new Date(`${hoy}T16:00:00Z`); // 10:00 en Merida
    // Apagado: nada.
    expect((await ejecutarRelojAvisos(puerto, t, diez)).apagado).toBe(true);
    expect(t.enviados).toHaveLength(0);
    // Omar no enciende nada.
    const rOmar = await modulo.interceptar({ chatId: -1, autor: OMAR, texto: '/avisos encender', clave: 'e2e:o1' });
    expect(rOmar?.textos[0]).toMatch(/permiso denegado|falta quien mando/);
    // Un socio enciende el general y la regla de atraso.
    await modulo.interceptar({ chatId: -1, autor: ANGELO, texto: '/avisos encender', clave: 'e2e:a1' });
    await modulo.interceptar({ chatId: -1, autor: ANGELO, texto: '/avisos regla oc_atraso encender', clave: 'e2e:a2' });
    await sql("select agente.avisos_inventario_evaluar(null, 'emitir')");
    const r1 = await ejecutarRelojAvisos(puerto, t, diez);
    expect(r1.enviados.map((x) => x.ventana)).toEqual(['I']);
    expect(t.enviados).toHaveLength(1);
    expect(t.enviados[0]).toMatch(/lleva 3 dias de atraso/);
    expect(t.enviados[0]).toContain('de Isaac');
    // Segunda pasada y segunda evaluacion: ni se repite ni se encola de nuevo.
    await sql("select agente.avisos_inventario_evaluar(null, 'emitir')");
    expect((await ejecutarRelojAvisos(puerto, t, new Date(diez.getTime() + 15 * 60_000))).enviados).toHaveLength(0);
    expect(t.enviados).toHaveLength(1);
  });

  it('/minimo por el adaptador real: pregunta lo que falta, exige escritura y registra con el aviso al grupo', async () => {
    const puerto = new PuertoAvisosInventarioDb(sql);
    const modulo = new ModuloInventarioBot(puerto);
    const di = (texto: string, clave: string) => modulo.interceptar({ chatId: -4242, autor: ANGELO, texto, clave });
    // Escritura apagada de origen: el bot lo dice y no escribe.
    expect((await di('/minimo e2e nexa mango 30', 'e2e:m0'))?.textos[0]).toContain('solo lectura');
    await sql("select agente.fijar_escritura(true, 'angelo', 7100001, 'e2e')");
    expect((await di('/minimo', 'e2e:m1'))?.textos[0]).toContain('¿De qué modelo y sabor');
    expect((await di('e2e nexa', 'e2e:m2'))?.textos[0]).toBe('¿De qué sabor de E2E NEXA?');
    expect((await di('mango', 'e2e:m3'))?.textos[0]).toContain('¿Cuántas piezas es el mínimo de E2E NEXA MANGO?');
    const fin = await di('30', 'e2e:m4');
    expect(fin?.textos[0]).toBe('Mínimo registrado: E2E NEXA MANGO en 30 piezas.');
    expect(fin?.textos[1]).toContain('Angelo fijó el mínimo de E2E NEXA MANGO en 30 piezas.');
    const filas = await sql<{ min_pz: number }>("select m.min_pz from agente.minimo_manual m where m.vigente_hasta is null and m.sku_id = (select k.id from catalogo.sku k join catalogo.sabor s on s.id = k.sabor_id where s.nombre_canonico = 'Mango' and k.modelo_id = (select id from catalogo.modelo where nombre_canonico = 'E2e Nexa'))");
    expect(filas[0]?.min_pz).toBe(30);
  });

  it('/vende y /reponer devuelven cifras de SQL', async () => {
    const modulo = new ModuloInventarioBot(new PuertoAvisosInventarioDb(sql));
    const rep = await modulo.interceptar({ chatId: -4242, autor: ANGELO, texto: '/reponer', clave: 'e2e:r1' });
    expect(rep?.textos[0]).toMatch(/^Que reponer\n/);
    const ven = await modulo.interceptar({ chatId: -4242, autor: ANGELO, texto: '/vende', clave: 'e2e:v1' });
    expect(ven?.textos[0]).toMatch(/^Lo que mas se vende/);
  });
});
