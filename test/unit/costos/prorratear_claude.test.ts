import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { agregar, ceilDiv, ejecutar, esProyectoRtm, leerUsoDeLinea, leerUsoDeRegistro, parsearArgs, mesMerida, prorratear, PROYECTOS_RTM_POR_OMISION } from '../../../scripts/costos/prorratear-claude.mjs';
import { ceilDiv as ceilDivDominio } from '@/dominio/dinero/techo';
import { leerUsoClaude, participacionClaude } from '@/dominio/costos/claude';

const PATRON = ['-Users-x-rtm'];
const SCRIPT = join(__dirname, '../../../scripts/costos/prorratear-claude.mjs');
const SENTINELA = 'SENTINELA-CONTENIDO-PRIVADO-8f3a';
const SENTINELA_RUTA = '/ruta/SENTINELA-RUTA-PRIVADA-91bc';

interface Uso {
  i: number;
  o: number;
  cc: number;
  cr: number;
}

function registro(id: string | null, ts: string, u: Uso): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    cwd: SENTINELA_RUTA,
    toolUseResult: { stdout: SENTINELA },
    message: {
      ...(id ? { id } : {}),
      role: 'assistant',
      content: [{ type: 'text', text: SENTINELA }],
      usage: { input_tokens: u.i, output_tokens: u.o, cache_creation_input_tokens: u.cc, cache_read_input_tokens: u.cr, service_tier: 'standard' },
    },
  });
}

function escribir(ruta: string, lineas: string[]) {
  mkdirSync(join(ruta, '..'), { recursive: true });
  writeFileSync(ruta, `${lineas.join('\n')}\n`);
}

let raiz = '';
let salida = '';

beforeAll(() => {
  raiz = mkdtempSync(join(tmpdir(), 'rtm-claude-raiz-'));
  salida = mkdtempSync(join(tmpdir(), 'rtm-claude-salida-'));
  const NOV = '2026-11-10T15:00:00Z';
  // RTM principal: m1 aparece dos veces mientras se transmite (parcial y final) y se cuenta una vez.
  escribir(join(raiz, '-Users-x-rtm', 's1.jsonl'), [
    registro('m1', NOV, { i: 10, o: 5, cc: 30, cr: 1000 }),
    registro('m1', NOV, { i: 10, o: 20, cc: 30, cr: 1000 }),
    registro('m2', NOV, { i: 1, o: 2, cc: 3, cr: 4 }),
    '{esto no es json "usage"',
    JSON.stringify({ type: 'user', timestamp: NOV, message: { content: SENTINELA } }),
    registro('m-dic', '2026-12-01T06:00:00Z', { i: 999, o: 999, cc: 999, cr: 999 }), // 00:00 del 1-dic en Merida: fuera
    registro('m-borde', '2026-12-01T05:59:59Z', { i: 0, o: 0, cc: 0, cr: 0 }), // 23:59 del 30-nov en Merida: dentro, en cero
  ]);
  // Subagente de RTM: otro archivo, misma carpeta de proyecto.
  escribir(join(raiz, '-Users-x-rtm', 's1', 'subagents', 'agent-a.jsonl'), [registro('m3', NOV, { i: 4, o: 6, cc: 0, cr: 100 }), registro('m1', NOV, { i: 10, o: 20, cc: 30, cr: 1000 })]);
  // Worktree de RTM: tambien es RTM.
  escribir(join(raiz, '-Users-x-rtm--claude-worktrees-wf1', 's2.jsonl'), [registro('m4', NOV, { i: 5, o: 5, cc: 5, cr: 50 })]);
  // Otros proyectos: uno de nombre parecido (no es RTM) y uno ajeno.
  escribir(join(raiz, '-Users-x-rtmextra', 's3.jsonl'), [registro('m5', NOV, { i: 100, o: 100, cc: 100, cr: 1000 })]);
  escribir(join(raiz, '-Users-x-otro', 's4.jsonl'), [registro(null, NOV, { i: 0, o: 0, cc: 0, cr: 100 })]);
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
  rmSync(salida, { recursive: true, force: true });
});

// RTM: m1 = 10+20+30 = 60; m2 = 6; m3 = 10; m4 = 15; m-borde = 0  -> 91
// Cuenta: 91 + m5 (300) + sin id (0)                                    -> 391
describe('prorrateo con transcripciones sinteticas', () => {
  it('da la participacion esperada por metrica (sin duplicados por message.id)', async () => {
    const r = await prorratear({ raiz, mes: '2026-11', patrones: PATRON });
    const p = r.metricas.entrada_salida_escritura_cache!;
    expect(p.tokens_rtm).toBe(91);
    expect(p.tokens_cuenta).toBe(391);
    expect(p.pct_exacto_ppm).toBe(232_736); // 23.27 % truncado
    expect(p.pct_aplicado_ppm).toBe(240_000); // techo al punto: 24 %
    const s = r.metricas.solo_salida!;
    expect([s.tokens_rtm, s.tokens_cuenta, s.pct_aplicado_ppm]).toEqual([33, 133, 250_000]);
    const t = r.metricas.todo_con_lectura_cache!;
    expect([t.tokens_rtm, t.tokens_cuenta]).toEqual([1245, 2645]);
    expect(t.pct_aplicado_ppm).toBe(480_000);
  });

  it('las sesiones de subagentes cuentan en la sesion que las lanzo', async () => {
    const r = await prorratear({ raiz, mes: '2026-11', patrones: PATRON });
    expect(r.rtm.sesiones).toBe(2);
    expect(r.cuenta.sesiones).toBe(4);
    expect(r.cuenta.mensajes).toBe(7); // m1,m2,m3,m4,m5,m-borde y el mensaje sin id
    expect(r.rtm.mensajes).toBe(5);
  });

  it('un mes sin mensajes no inventa participacion (nulos)', async () => {
    const r = await prorratear({ raiz, mes: '2026-01' });
    expect(r.cuenta.mensajes).toBe(0);
    expect(r.metricas.entrada_salida_escritura_cache!.pct_aplicado_ppm).toBeNull();
  });

  it('el JSON que produce lo entiende el dominio y da 24 %', async () => {
    const r = await prorratear({ raiz, mes: '2026-11', patrones: PATRON });
    const uso = leerUsoClaude(JSON.parse(JSON.stringify(r)));
    expect(participacionClaude(uso.principal).aplicadoPpm).toBe(240_000n);
  });

  it('un proyecto indicado con --proyecto sustituye al patron por omision', async () => {
    const r = await prorratear({ raiz, mes: '2026-11', patrones: ['-Users-x-otro'] });
    expect(r.metricas.entrada_salida_escritura_cache!.tokens_rtm).toBe(0);
  });

  it('valida mes y carpeta', async () => {
    await expect(prorratear({ raiz, mes: '2026-13' })).rejects.toThrow(/AAAA-MM/);
    await expect(prorratear({ raiz: join(raiz, 'no-existe'), mes: '2026-11' })).rejects.toThrow(/No existe/);
  });
});

describe('no lee contenido', () => {
  function vigilado<T extends object>(obj: T, permitidas: Record<string, string[] | null>, ruta = ''): T {
    return new Proxy(obj, {
      get(t, k) {
        if (typeof k === 'symbol') return undefined;
        const camino = ruta ? `${ruta}.${k}` : k;
        if (!(camino in permitidas)) throw new Error(`lectura prohibida de ${camino}`);
        const v = (t as Record<string, unknown>)[k];
        return v !== null && typeof v === 'object' ? vigilado(v as object, permitidas, camino) : v;
      },
    });
  }
  const PERMITIDAS = {
    timestamp: null,
    message: null,
    'message.id': null,
    'message.usage': null,
    'message.usage.input_tokens': null,
    'message.usage.output_tokens': null,
    'message.usage.cache_creation_input_tokens': null,
    'message.usage.cache_read_input_tokens': null,
  };

  it('leerUsoDeRegistro toca solo timestamp, message.id y message.usage', () => {
    const crudo = JSON.parse(registro('mx', '2026-11-10T15:00:00Z', { i: 1, o: 2, cc: 3, cr: 4 }));
    const uso = leerUsoDeRegistro(vigilado(crudo, PERMITIDAS));
    expect(uso).toEqual({ id: 'mx', mes: '2026-11', entrada: 1n, salida: 2n, escritura: 3n, lectura: 4n });
  });

  it('el vigilante si detecta una lectura del contenido (la prueba tiene dientes)', () => {
    const crudo = JSON.parse(registro('mx', '2026-11-10T15:00:00Z', { i: 1, o: 2, cc: 3, cr: 4 }));
    expect(() => vigilado(crudo, PERMITIDAS).message.content).toThrow(/prohibida/);
    expect(() => vigilado(crudo, PERMITIDAS).cwd).toThrow(/prohibida/);
  });

  it('la salida del script (archivo, stdout y stderr) no contiene contenido ni rutas de trabajo', () => {
    const r = spawnSync('node', [SCRIPT, '--mes', '2026-11', '--raiz', raiz, '--salida', salida, '--proyecto', '-Users-x-rtm'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const archivo = join(salida, 'claude-uso-2026-11.json');
    const texto = readFileSync(archivo, 'utf8');
    for (const fuente of [texto, r.stdout, r.stderr]) {
      expect(fuente).not.toContain(SENTINELA);
      expect(fuente).not.toContain(SENTINELA_RUTA);
      expect(fuente).not.toContain('SENTINELA');
    }
    expect(JSON.parse(texto).campos_leidos).toEqual(['timestamp', 'message.id', 'message.usage']);
    // El sha256 impreso coincide con el del archivo escrito.
    const sha = /sha256 ([0-9a-f]{64})/.exec(r.stdout)?.[1];
    expect(sha).toBe(createHash('sha256').update(texto).digest('hex'));
    expect(JSON.parse(texto).metricas.entrada_salida_escritura_cache.pct_aplicado_ppm).toBe(240_000);
  });

  it('mes sin datos: sale con codigo 2, avisa "Sin dato" y no escribe archivo', () => {
    const r = spawnSync('node', [SCRIPT, '--mes', '2026-02', '--raiz', raiz, '--salida', salida], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Sin dato');
    expect(existsSync(join(salida, 'claude-uso-2026-02.json'))).toBe(false);
  });

  it('argumentos invalidos: error legible y codigo 1', () => {
    for (const args of [[], ['--mes'], ['--mes', '2026-11', '--raro']]) {
      const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr.length).toBeGreaterThan(0);
    }
    expect(() => execFileSync('node', [SCRIPT, '--mes', '2026-11', '--raiz', join(raiz, 'nada')], { stdio: 'pipe' })).toThrow();
  });
});

describe('piezas del script', () => {
  it('mesMerida: UTC-6 fijo en los bordes del mes', () => {
    expect(mesMerida('2026-12-01T05:59:59Z')).toBe('2026-11');
    expect(mesMerida('2026-12-01T06:00:00Z')).toBe('2026-12');
    expect(mesMerida('basura')).toBeNull();
    expect(mesMerida(42)).toBeNull();
  });
  it('leerUsoDeRegistro ignora registros sin usage, sin instante o que no son objetos; valores raros cuentan 0', () => {
    expect(leerUsoDeRegistro(null)).toBeNull();
    expect(leerUsoDeRegistro('x')).toBeNull();
    expect(leerUsoDeRegistro({ timestamp: '2026-11-01T12:00:00Z' })).toBeNull();
    expect(leerUsoDeRegistro({ timestamp: '2026-11-01T12:00:00Z', message: { usage: null } })).toBeNull();
    expect(leerUsoDeRegistro({ timestamp: 'mal', message: { usage: {} } })).toBeNull();
    expect(leerUsoDeRegistro({ timestamp: '2026-11-01T12:00:00Z', message: { usage: { input_tokens: -5, output_tokens: 1.5, cache_creation_input_tokens: 'x' } } })).toEqual({ id: null, mes: '2026-11', entrada: 0n, salida: 0n, escritura: 0n, lectura: 0n });
  });
  it('esProyectoRtm: igual o prefijo con guion; no confunde nombres parecidos', () => {
    const p = PROYECTOS_RTM_POR_OMISION;
    expect(esProyectoRtm('-Users-javiercamaraportepetit-rtm', p)).toBe(true);
    expect(esProyectoRtm('-Users-javiercamaraportepetit-rtm--claude-worktrees-wf', p)).toBe(true);
    expect(esProyectoRtm('-Users-javiercamaraportepetit-rtmextra', p)).toBe(false);
    expect(esProyectoRtm('-Users-javiercamaraportepetit-likida', p)).toBe(false);
  });
  it('ceilDiv del script es identico al del dominio (paridad por propiedad)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 15n), max: 10n ** 15n }), fc.bigInt({ min: 1n, max: 10n ** 9n }), (a, b) => {
        expect(ceilDiv(a, b)).toBe(ceilDivDominio(a, b));
      }),
      { numRuns: 300 },
    );
    expect(() => ceilDiv(1n, 0n)).toThrow(RangeError);
  });
  it('el porcentaje aplicado nunca es menor que la fraccion real (propiedad)', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.boolean(), fc.nat(1_000_000)), { minLength: 1, maxLength: 30 }), (pares) => {
        const mensajes = new Map(pares.map(([esRtm, tokens], i) => [`m${i}`, { carpeta: esRtm ? '-a-rtm' : '-a-otro', sesion: `s${i}`, u: { entrada: BigInt(tokens), salida: 0n, escritura: 0n, lectura: 0n } }]));
        const r = agregar({ mensajes, mes: '2026-11', patrones: ['-a-rtm'] });
        const m = r.metricas.entrada_salida_escritura_cache!;
        if (m.tokens_cuenta === 0) return;
        expect(BigInt(m.pct_aplicado_ppm as number) * BigInt(m.tokens_cuenta as number) >= BigInt(m.tokens_rtm as number) * 1_000_000n).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('CLI en proceso', () => {
  const io = () => {
    const log: string[] = [];
    const error: string[] = [];
    return { log, error, io: { log: (m: string) => log.push(m), error: (m: string) => error.push(m) } };
  };
  it('ejecuta, escribe el archivo con permisos 600 e imprime sha256 sin contenido', async () => {
    const o = io();
    const salidaLocal = mkdtempSync(join(tmpdir(), 'rtm-claude-cli-'));
    try {
      const codigo = await ejecutar(['--mes', '2026-11', '--raiz', raiz, '--salida', salidaLocal, '--proyecto', '-Users-x-rtm'], o.io);
      expect(codigo).toBe(0);
      expect(o.log.join('\n')).toMatch(/sha256 [0-9a-f]{64}/);
      expect(o.log.join('\n')).not.toContain('SENTINELA');
      expect(statSync(join(salidaLocal, 'claude-uso-2026-11.json')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(salidaLocal, { recursive: true, force: true });
    }
  });
  it('sin datos devuelve 2; argumentos malos devuelven 1', async () => {
    const a = io();
    expect(await ejecutar(['--mes', '2026-02', '--raiz', raiz, '--salida', salida], a.io)).toBe(2);
    expect(a.error[0]).toContain('Sin dato');
    const b = io();
    expect(await ejecutar(['--raro'], b.io)).toBe(1);
    expect(await ejecutar([], b.io)).toBe(1);
    expect(await ejecutar(['--mes'], b.io)).toBe(1);
    expect(await ejecutar(['--mes', '2026-11', '--raiz', join(raiz, 'nada')], b.io)).toBe(1);
  });
  it('parsearArgs usa valores por omision y acepta varios --proyecto', () => {
    const a = parsearArgs(['--mes', '2026-11', '--proyecto', 'a', '--proyecto', 'b']);
    expect(a.proyectos).toEqual(['a', 'b']);
    expect(a.raiz).toContain('.claude');
  });
  it('leerUsoDeLinea descarta JSON roto y devuelve solo el uso permitido', () => {
    expect(leerUsoDeLinea('{roto')).toBeNull();
    const uso = leerUsoDeLinea(registro('mz', '2026-11-03T12:00:00Z', { i: 1, o: 1, cc: 1, cr: 1 }));
    expect(uso).toEqual({ id: 'mz', mes: '2026-11', entrada: 1n, salida: 1n, escritura: 1n, lectura: 1n });
    expect(JSON.stringify(uso, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))).not.toContain('SENTINELA');
  });
});
