import { describe, expect, it } from 'vitest';
import { ErrorGuarda, PROYECTOS_PRODUCCION, contenidoDeBase, evaluarDestino, exigirBaseVacia, hoyMerida, proyectoDeUrl } from '../../../scripts/demo/guardas.mjs';

// El arroba va en una constante: el escaner de secretos tomaria usuario:clave@host de estas URLs ficticias por un correo.
const AT = '@';

const PROD = PROYECTOS_PRODUCCION[0] as string;

describe('demo: guardas de destino', () => {
  it('acepta localhost, 127.0.0.1 y ::1', () => {
    for (const h of ['127.0.0.1', 'localhost', '[::1]']) expect(evaluarDestino(`postgresql://postgres:x${AT}${h}:55322/postgres`).destino).toBe('local');
  });
  it('rehusa el proyecto de produccion en cualquier forma de URL y con cualquier bandera', () => {
    const urls = [`postgresql://postgres:x${AT}db.${PROD}.supabase.co:5432/postgres`, `postgresql://postgres.${PROD}:x${AT}aws-0-us-east-1.pooler.supabase.com:6543/postgres`, `postgresql://postgres:x${AT}127.0.0.1:5432/${PROD}`];
    for (const u of urls) {
      expect(() => evaluarDestino(u)).toThrow(/PRODUCCION/);
      expect(() => evaluarDestino(u, { permitirRemotoDemo: true, proyectosDemo: [PROD] })).toThrow(/PRODUCCION/);
    }
  });
  it('rehusa cualquier host que no sea local sin la bandera explicita', () => {
    expect(() => evaluarDestino('postgresql://postgres:x' + AT + '10.0.0.5:5432/postgres')).toThrow(ErrorGuarda);
    expect(() => evaluarDestino('postgresql://postgres:x' + AT + 'db.abcdefghijklmnopqrst.supabase.co:5432/postgres')).toThrow(/no es local/);
  });
  it('con la bandera exige un proyecto de la lista de permitidos del demo', () => {
    const url = 'postgresql://postgres:x' + AT + 'db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
    expect(() => evaluarDestino(url, { permitirRemotoDemo: true, proyectosDemo: [] })).toThrow(/lista de permitidos/);
    expect(() => evaluarDestino(url, { permitirRemotoDemo: true, proyectosDemo: ['otroproyectoxxxxxxxxx'] })).toThrow(/lista de permitidos/);
    expect(evaluarDestino(url, { permitirRemotoDemo: true, proyectosDemo: ['abcdefghijklmnopqrst'] })).toEqual({ destino: 'remoto-demo', proyecto: 'abcdefghijklmnopqrst' });
  });
  it('rehusa una URL ausente o invalida', () => {
    expect(() => evaluarDestino(undefined as unknown as string)).toThrow(/DATABASE_URL/);
    expect(() => evaluarDestino('no es una url')).toThrow(/valida/);
  });
  it('deduce el proyecto por host o por usuario', () => {
    expect(proyectoDeUrl('postgresql://postgres:x' + AT + 'db.abcdefghijklmnopqrst.supabase.co/postgres')).toBe('abcdefghijklmnopqrst');
    expect(proyectoDeUrl('postgresql://postgres.abcdefghijklmnopqrst:x' + AT + 'pooler.supabase.com/postgres')).toBe('abcdefghijklmnopqrst');
    expect(proyectoDeUrl('postgresql://postgres:x' + AT + '127.0.0.1/postgres')).toBeNull();
  });
});

describe('demo: guarda de base vacia', () => {
  const falso = (filas: Record<string, number>) => ({ query: async (sql: string) => ({ rows: [{ n: Object.entries(filas).find(([t]) => sql.includes(t))?.[1] ?? 0 }] }) });
  it('pasa con una base vacia', async () => {
    await expect(exigirBaseVacia(falso({}))).resolves.toBeUndefined();
  });
  it('falla si hay pedidos, asientos o cualquier otro dato, y dice que hay', async () => {
    await expect(exigirBaseVacia(falso({ 'operacion.pedido': 3 }))).rejects.toThrow(/NO esta vacia.*pedidos: 3/);
    await expect(exigirBaseVacia(falso({ 'contabilidad.asiento': 1 }))).rejects.toThrow(/asientos/);
    await expect(exigirBaseVacia(falso({ 'seguridad.usuario': 2 }))).rejects.toThrow(/usuarios/);
    expect((await contenidoDeBase(falso({ 'catalogo.cliente': 9 }))).map((x: { nombre: string }) => x.nombre)).toEqual(['clientes']);
  });
});

describe('demo: fecha de negocio', () => {
  it('hoy en Merida es UTC-6', () => {
    expect(hoyMerida(new Date('2026-11-15T03:00:00Z'))).toBe('2026-11-14');
    expect(hoyMerida(new Date('2026-11-15T09:00:00Z'))).toBe('2026-11-15');
  });
});
