import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Reglas de la ola sobre el codigo del modulo del agente: sin console.log, sin any, sin emojis, sin nombrar la pagina de origen
// del scraper, sin llaves/tokens, y sin que el modelo reciba herramientas.
const raiz = join(__dirname, '../../..');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|mts|txt)$/.test(n) ? [p] : [];
  });
}

const MODULO = [
  ...archivos(join(raiz, 'src/dominio/agente')),
  ...archivos(join(raiz, 'src/aplicacion/agente')),
  ...archivos(join(raiz, 'src/infra/agente')),
  join(raiz, 'src/composicion/agente.ts'),
  join(raiz, 'src/composicion/simulador_agente.ts'),
  ...archivos(join(raiz, 'scripts/agente')),
  ...archivos(join(raiz, 'test/unit/agente')),
];

const sinEsteArchivo = MODULO.filter((f) => !f.endsWith('reglas.test.ts'));

describe('reglas del modulo del agente', () => {
  it('el modulo existe y tiene archivos', () => {
    expect(sinEsteArchivo.length).toBeGreaterThan(20);
  });
  it('sin console.log ni any explicito', () => {
    const malos = sinEsteArchivo.filter((f) => {
      const t = readFileSync(f, 'utf8');
      return /console\.(log|info|debug)\(/.test(t) || /:\s*any\b|as any\b|<any>/.test(t);
    });
    expect(malos).toEqual([]);
  });
  it('sin emojis', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    expect(sinEsteArchivo.filter((f) => emoji.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('la pagina de origen del scraper no figura en codigo ni en textos', () => {
    const nombre = ['mr', 'cac' + 'tus'].join('[ -_]?');
    const re = new RegExp(nombre, 'i');
    expect(sinEsteArchivo.filter((f) => re.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
  it('el extractor no recibe herramientas: la peticion al modelo no declara tools ni funciones', () => {
    const t = readFileSync(join(raiz, 'src/infra/agente/openrouter.ts'), 'utf8');
    expect(/\btools\b|tool_choice|functions\b/.test(t.replace(/\/\/.*$/gm, ''))).toBe(false);
  });
  it('el dinero no se calcula con numeros de coma flotante en el dominio del agente', () => {
    const dom = archivos(join(raiz, 'src/dominio/agente')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(/parseFloat|toFixed|Math\.round\(.*precio/.test(dom)).toBe(false);
  });
  it('el modulo no lee variables de entorno ni toca el reloj del sistema fuera de los dobles', () => {
    const malos = [...archivos(join(raiz, 'src/dominio/agente')), ...archivos(join(raiz, 'src/aplicacion/agente'))].filter((f) =>
      /process\.env|Date\.now\(|new Date\(\)|Math\.random\(/.test(readFileSync(f, 'utf8')),
    );
    expect(malos).toEqual([]);
  });
});
