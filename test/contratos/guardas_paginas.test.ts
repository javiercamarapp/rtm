// Guarda de capa 2: la zona de socio no depende de que alguien se acuerde de proteger cada pagina.
//  - el layout de (socio) exige socio antes de renderizar cualquier pagina;
//  - todo route handler y todo archivo de acciones del servidor de (socio) pasa por una funcion de composicion que exige socio;
//  - ninguna pagina, accion ni handler de (socio) importa infra ni el cliente de servidor (service_role no se usa).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = join(process.cwd(), 'src', 'app', '(socio)');
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : [p];
  });
}
const todos = archivos(RAIZ).filter((f) => /\.(ts|tsx)$/.test(f));

describe('zona de socio', () => {
  it('el layout exige socio', () => {
    expect(readFileSync(join(RAIZ, 'layout.tsx'), 'utf8')).toMatch(/await exigirSocio\(\)/);
  });
  it('los route handlers entregan documentos solo tras exigir socio', () => {
    const rutas = todos.filter((f) => /[\\/]route\.ts$/.test(f));
    expect(rutas.length).toBeGreaterThan(0);
    for (const f of rutas) expect(readFileSync(f, 'utf8'), f).toMatch(/documentoDeNota|documentoDeDevolucion|exigirSocio/);
  });
  it('las acciones del servidor llaman a la composicion, que exige socio', () => {
    const acciones = todos.filter((f) => readFileSync(f, 'utf8').startsWith("'use server'"));
    expect(acciones.length).toBeGreaterThan(0);
    for (const f of acciones) expect(readFileSync(f, 'utf8'), f).toMatch(/from '@\/composicion\//);
  });
  it('ningun archivo de la zona importa infra ni el cliente de servidor', () => {
    for (const f of todos) expect(readFileSync(f, 'utf8'), f).not.toMatch(/@\/infra\/|cliente-servidor/);
  });
});
