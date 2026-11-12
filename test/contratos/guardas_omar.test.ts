// Guarda de capa 2 de la zona de Omar (espejo de la de socio): no depende de que alguien se acuerde de proteger cada pagina, y nada del negocio ajeno cruza.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(process.cwd(), 'src', 'app', '(omar)');
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}
const todos = archivos(RAIZ).filter((f) => /\.(ts|tsx)$/.test(f));
const lee = (f: string) => readFileSync(f, 'utf8');

describe('zona de Omar', () => {
  it('el layout exige Omar activo antes de renderizar', () => {
    expect(lee(join(RAIZ, 'layout.tsx'))).toMatch(/await exigirOmar\(\)/);
  });
  it('las acciones del servidor llaman a la composicion, que exige Omar', () => {
    const acciones = todos.filter((f) => lee(f).startsWith("'use server'"));
    expect(acciones.length).toBeGreaterThan(0);
    for (const f of acciones) expect(lee(f), f).toMatch(/from '@\/composicion\//);
    expect(lee(join(process.cwd(), 'src', 'composicion', 'omar.ts'))).toMatch(/await exigirOmar\(\)/);
  });
  it('ninguna pagina importa infra, el cliente de servidor ni codigo de las paginas de socio', () => {
    for (const f of todos) expect(lee(f), f).not.toMatch(/@\/infra\/|cliente-servidor|\(socio\)|\/operacion\/lecturas|composicion\/operacion|composicion\/catalogo/);
  });
  it('la zona no usa roles de socio ni palabras de negocio ajeno', () => {
    for (const f of todos) expect(lee(f), f).not.toMatch(/exigirSocio|operacionDeSocio|Dueño/);
  });
  it('el adaptador de Omar lee SOLO del esquema omar', () => {
    const src = lee(join(process.cwd(), 'src', 'infra', 'supabase', 'omar.ts'));
    expect(src).not.toMatch(/\.schema\('(?!omar')/);
    expect(src).not.toMatch(/sb\.rpc\(/);
    expect(src).not.toMatch(/\.from\('(?!v_|\$)/);
  });
  it('las funciones omar.* que el adaptador usa estan todas documentadas en docs/pendiente-sql-omar.md', () => {
    const src = lee(join(process.cwd(), 'src', 'infra', 'supabase', 'omar.ts'));
    const doc = lee(join(process.cwd(), 'docs', 'pendiente-sql-omar.md'));
    const usadas = [...src.matchAll(/(?:funcion\(|rpc\()'([a-z_]+)'/g)].map((m) => m[1]!);
    expect(usadas.length).toBeGreaterThanOrEqual(5);
    for (const fn of usadas) expect(doc, fn).toContain(`omar.${fn}(`);
  });
});
