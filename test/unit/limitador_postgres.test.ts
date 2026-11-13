import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LimitadorNoDisponible } from '@/aplicacion/acceso/puertos';

// El adaptador de Postgres se prueba con un pg falso: sin red ni base. Lo que importa es que NINGUN fallo se convierta en «no excede».
const consulta = vi.fn();
vi.mock('pg', () => ({
  default: { Pool: class { query = consulta; on() {} } },
}));
vi.mock('@/config/env', () => ({ env: () => ({ LIMITE_PIMIENTA: 'p'.repeat(24), SERVIDOR_DATABASE_URL: 'postgresql://127.0.0.1:1/x' }) }));

const { limitadorPostgres, TOPE_TOTAL_MS } = await import('@/infra/limite/limitador_postgres');
const tope = { limite: 3, ventanaSeg: 600 };

describe('limitadorPostgres: falla CERRADO', () => {
  beforeEach(() => consulta.mockReset());

  it('con la base respondiendo cuenta y compara contra el tope', async () => {
    consulta.mockResolvedValueOnce({ rows: [{ n: 3 }] }).mockResolvedValueOnce({ rows: [{ n: 4 }] });
    const l = limitadorPostgres();
    expect(await l.excede('correo', 'a@example.test', tope)).toBe(false);
    expect(await l.excede('correo', 'a@example.test', tope)).toBe(true);
  });

  it.each([
    ['conexion rechazada', Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' }), 'ECONNREFUSED'],
    ['rol sin login', Object.assign(new Error('role "servidor" is not permitted to log in'), { code: '28000' }), '28000'],
    ['tiempo agotado', Object.assign(new Error('Query read timeout'), {}), 'DESCONOCIDO'],
  ])('%s: lanza LimitadorNoDisponible sin filtrar el mensaje original', async (_n, error, codigo) => {
    consulta.mockRejectedValueOnce(error).mockRejectedValueOnce(error);
    const intento = limitadorPostgres().excede('ip', '203.0.113.9', tope);
    await expect(intento).rejects.toBeInstanceOf(LimitadorNoDisponible);
    await expect(intento).rejects.toMatchObject({ codigo, message: 'limitador no disponible' });
  });

  it('una respuesta que no es un numero tambien falla cerrado', async () => {
    consulta.mockResolvedValueOnce({ rows: [] });
    await expect(limitadorPostgres().excede('ip', '203.0.113.9', tope)).rejects.toBeInstanceOf(LimitadorNoDisponible);
    consulta.mockResolvedValueOnce({ rows: [{ n: 'no-numero' }] });
    await expect(limitadorPostgres().excede('ip', '203.0.113.9', tope)).rejects.toBeInstanceOf(LimitadorNoDisponible);
  });

  it('un arranque en frio (primer intento falla) se recupera con UN reintento y cuenta normalmente', async () => {
    consulta.mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })).mockResolvedValueOnce({ rows: [{ n: 4 }] });
    expect(await limitadorPostgres().excede('correo', 'a@example.test', tope)).toBe(true);
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('si el reintento tambien falla, falla cerrado con el codigo del ultimo error y con exactamente 2 consultas', async () => {
    consulta.mockRejectedValueOnce(Object.assign(new Error('a'), { code: 'ETIMEDOUT' })).mockRejectedValueOnce(Object.assign(new Error('b'), { code: 'ECONNREFUSED' }));
    await expect(limitadorPostgres().excede('ip', '203.0.113.9', tope)).rejects.toMatchObject({ codigo: 'ECONNREFUSED' });
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('una respuesta invalida NO se reintenta (no es un fallo transitorio)', async () => {
    consulta.mockResolvedValue({ rows: [] });
    await expect(limitadorPostgres().excede('ip', '203.0.113.9', tope)).rejects.toBeInstanceOf(LimitadorNoDisponible);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('el presupuesto total de tiempo (dos topes de intento y la pausa) no pasa de 3 s', () => {
    expect(TOPE_TOTAL_MS).toBeLessThanOrEqual(3_000);
  });
});
