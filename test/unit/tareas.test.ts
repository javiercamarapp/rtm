import { describe, expect, it } from 'vitest';
import { correrLatido, type DefTarea, type PuertoTareas } from '@/aplicacion/tareas/latido';
import { TAREAS, cronsDeVercel } from '@/config/tareas';
import { coincide, parsearCron, ventanasDebidas } from '@/dominio/tareas';

describe('cron de la lista de tareas', () => {
  it('parsea pasos, listas y rangos', () => {
    const c = parsearCron('*/15 1-3,22 * * 1');
    expect([...c.minutos]).toEqual([0, 15, 30, 45]);
    expect([...c.horas]).toEqual([1, 2, 3, 22]);
    expect(() => parsearCron('61 * * * *')).toThrow();
    expect(() => parsearCron('* * *')).toThrow();
  });
  it('el semanal sale el lunes 06:00 de Merida = 12:00 UTC (16-nov-2026)', () => {
    const c = parsearCron(TAREAS.find((t) => t.tarea === 'reporte-semanal')!.expresionUtc);
    expect(coincide(c, new Date('2026-11-16T12:00:00Z'))).toBe(true);
    expect(coincide(c, new Date('2026-11-17T12:00:00Z'))).toBe(false);
    expect(coincide(c, new Date('2026-11-16T11:59:00Z'))).toBe(false);
  });
  it('a las 02:05 UTC del sabado 14-nov corre la liquidacion con el proveedor (es viernes 13 en Merida)', () => {
    const c = parsearCron(TAREAS.find((t) => t.tarea === 'liquidacion-isaac')!.expresionUtc);
    expect(coincide(c, new Date('2026-11-14T02:05:00Z'))).toBe(true);
  });
  it('cada tarea con hora local fija coincide con su expresion UTC (UTC-6, sin horario de verano)', () => {
    for (const t of TAREAS.filter((x) => x.horaLocal)) {
      const [min, hora] = t.expresionUtc.split(' ');
      expect(Number(min), t.tarea).toBe(t.horaLocal!.minuto);
      expect(Number(hora), t.tarea).toBe((t.horaLocal!.hora + 6) % 24);
    }
  });
  it('los nombres son unicos, toda expresion es valida y solo el latido va a vercel.json', () => {
    expect(new Set(TAREAS.map((t) => t.tarea)).size).toBe(TAREAS.length);
    for (const t of TAREAS) expect(() => parsearCron(t.expresionUtc), t.tarea).not.toThrow();
    expect(cronsDeVercel()).toEqual([{ path: '/api/tareas/latido', schedule: '*/5 * * * *' }]);
  });
  it('ventanas debidas en un intervalo', () => {
    expect(ventanasDebidas('*/5 * * * *', new Date('2026-11-16T12:00:00Z'), new Date('2026-11-16T12:10:00Z'))).toEqual(['2026-11-16T12:05', '2026-11-16T12:10']);
  });
});

class PuertoFalso implements PuertoTareas {
  reclamadas = new Set<string>();
  terminadas: { tarea: string; ventana: string; estado: string; error?: string }[] = [];
  async reclamar(t: string, v: string) {
    const k = `${t}|${v}`;
    if (this.reclamadas.has(k)) return false;
    this.reclamadas.add(k);
    return true;
  }
  async terminar(tarea: string, ventana: string, estado: 'ok' | 'error' | 'omitida', error?: string) {
    this.terminadas.push({ tarea, ventana, estado, ...(error ? { error } : {}) });
  }
}

describe('el latido', () => {
  const tareas: DefTarea[] = [
    { tarea: 'latido', expresionUtc: '*/5 * * * *', implementada: true },
    { tarea: 'reporte-semanal', expresionUtc: '0 12 * * 1', implementada: true },
    { tarea: 'resumen-diario', expresionUtc: '0 12 * * *', implementada: false },
    { tarea: 'rota', expresionUtc: '0 12 * * *', implementada: true },
  ];
  const ahora = new Date('2026-11-16T12:03:00Z');

  it('dos latidos para la misma ventana ejecutan UNA corrida', async () => {
    const puerto = new PuertoFalso();
    let corridas = 0;
    const entrada = { tareas, puerto, manejadores: { 'reporte-semanal': async () => { corridas++; return { estado: 'ok' as const }; }, rota: async () => { throw new TypeError('x'); } }, propio: async () => undefined, ahora };
    const a = await correrLatido(entrada);
    const b = await correrLatido({ ...entrada, ahora: new Date('2026-11-16T12:05:00Z') });
    expect(corridas).toBe(1);
    expect(a.ejecutadas).toEqual(['reporte-semanal@2026-11-16T12:00']);
    expect(b.ejecutadas).toEqual([]);
    expect(b.yaReclamadas).toBeGreaterThan(0);
  });
  it('una tarea sin implementar queda omitida y una que falla queda con el nombre del error, sin contenido', async () => {
    const puerto = new PuertoFalso();
    const r = await correrLatido({ tareas, puerto, manejadores: { 'reporte-semanal': async () => ({ estado: 'ok' }), rota: async () => { throw new TypeError('dato secreto'); } }, propio: async () => undefined, ahora });
    expect(r.omitidas).toContain('resumen-diario@2026-11-16T12:00');
    expect(r.fallidas).toEqual(['rota@2026-11-16T12:00']);
    expect(puerto.terminadas.find((x) => x.tarea === 'rota')).toMatchObject({ estado: 'error', error: 'TypeError' });
    expect(JSON.stringify(puerto.terminadas)).not.toContain('secreto');
  });
  it('el trabajo propio del latido corre siempre, aunque ninguna tarea este debida', async () => {
    let n = 0;
    await correrLatido({ tareas, puerto: new PuertoFalso(), manejadores: {}, propio: async () => { n++; }, ahora: new Date('2026-11-17T03:03:00Z') });
    expect(n).toBe(1);
  });
});
