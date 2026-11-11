import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Fronteras entre capas, comprobadas RECORRIENDO los imports (ademas de eslint-plugin-boundaries).
const raiz = join(__dirname, '../../src');

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx|mjs|js)$/.test(n) ? [p] : [];
  });
}

function importsDe(archivo: string): string[] {
  const src = readFileSync(archivo, 'utf8');
  const out: string[] = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g)) {
    out.push((m[1] ?? m[2] ?? m[3])!);
  }
  return out;
}

function capaDeRuta(abs: string): string | null {
  const rel = relative(raiz, abs).split('/');
  return ['dominio', 'aplicacion', 'infra', 'composicion', 'app', 'ui', 'config'].includes(rel[0]!) ? rel[0]! : null;
}

function capaDeImport(desde: string, spec: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2).split('/')[0]!;
  if (spec.startsWith('.')) return capaDeRuta(join(desde, '..', spec));
  return null; // paquete externo
}

const PERMITIDO: Record<string, string[]> = {
  dominio: ['dominio'],
  aplicacion: ['dominio', 'aplicacion'],
  infra: ['dominio', 'aplicacion', 'infra', 'config'],
  composicion: ['dominio', 'aplicacion', 'infra', 'composicion', 'config'],
  ui: ['dominio', 'ui', 'config'],
  app: ['dominio', 'aplicacion', 'composicion', 'app', 'ui', 'config'],
  config: ['config'],
};

describe('fronteras entre capas', () => {
  const todos = archivos(raiz).filter((f) => !/\.test\.(ts|tsx)$/.test(f));
  it('hay archivos en cada capa', () => {
    for (const c of Object.keys(PERMITIDO)) expect(todos.some((f) => capaDeRuta(f) === c)).toBe(true);
  });
  it('ningun import cruza una frontera prohibida', () => {
    const violaciones: string[] = [];
    for (const f of todos) {
      const capa = capaDeRuta(f);
      if (!capa) continue;
      for (const spec of importsDe(f)) {
        const destino = capaDeImport(f, spec);
        if (destino && destino in PERMITIDO && !PERMITIDO[capa]!.includes(destino)) violaciones.push(`${relative(raiz, f)} -> ${spec}`);
      }
    }
    expect(violaciones).toEqual([]);
  });
  it('el dominio solo importa del dominio: ningun paquete, ningun node:', () => {
    const malos: string[] = [];
    for (const f of todos.filter((x) => capaDeRuta(x) === 'dominio')) {
      for (const spec of importsDe(f)) if (!spec.startsWith('.') && !spec.startsWith('@/dominio')) malos.push(`${relative(raiz, f)} -> ${spec}`);
    }
    expect(malos).toEqual([]);
  });
  it('ningun archivo de app/(socio) ni app/(omar) importa el cliente de servidor de Supabase', () => {
    const malos: string[] = [];
    for (const f of todos.filter((x) => /app\/\((socio|omar)\)/.test(x))) {
      for (const spec of importsDe(f)) if (/infra\/supabase\/cliente-servidor/.test(spec)) malos.push(relative(raiz, f));
    }
    expect(malos).toEqual([]);
  });
  it('ninguna ruta de la web usa service_role ni lo expone con NEXT_PUBLIC_', () => {
    for (const f of archivos(raiz)) {
      const src = readFileSync(f, 'utf8');
      expect(src, relative(raiz, f)).not.toMatch(/service_role|SERVICE_ROLE/);
      expect(src, relative(raiz, f)).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PRIVATE|PIMIENTA|PASSWORD)/);
    }
  });
});
