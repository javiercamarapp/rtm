import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOTOS_MODELOS, MOTIVO_SIN_FOTO, rutaFotoModelo } from '@/dominio/catalogo/fotos-modelos';

const RAIZ = join(__dirname, '..', '..', '..');

describe('fotos de modelos', () => {
  it('la lista cubre cada modelo activo del catalogo una sola vez (87 al 14-nov)', () => {
    expect(FOTOS_MODELOS.length).toBe(87);
    expect(new Set(FOTOS_MODELOS.map((f) => f.id)).size).toBe(FOTOS_MODELOS.length);
    expect(new Set(FOTOS_MODELOS.map((f) => f.nombre.toLowerCase())).size).toBe(FOTOS_MODELOS.length);
  });

  it('todo modelo tiene foto o declara explicitamente que no la tiene', () => {
    for (const f of FOTOS_MODELOS) {
      expect(f.foto === null || /^[a-z0-9-]+$/.test(f.foto), `${f.nombre}: slug invalido`).toBe(true);
    }
    expect(MOTIVO_SIN_FOTO.length).toBeGreaterThan(10);
  });

  it('cada foto declarada existe como webp, ancho maximo 800 y menos de 150 KB', () => {
    for (const f of FOTOS_MODELOS.filter((x) => x.foto)) {
      const ruta = join(RAIZ, 'public', 'modelos', `${f.foto}.webp`);
      expect(existsSync(ruta), `${f.nombre}: falta ${ruta}`).toBe(true);
      expect(statSync(ruta).size).toBeLessThan(150 * 1024);
      const b = readFileSync(ruta);
      expect(b.subarray(0, 4).toString()).toBe('RIFF');
      expect(b.subarray(8, 12).toString()).toBe('WEBP');
    }
  });

  it('docs/fotos-modelos.md lista la procedencia de cada foto y los modelos sin foto', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'fotos-modelos.md'), 'utf8');
    for (const f of FOTOS_MODELOS) {
      expect(doc, `${f.nombre} no aparece en docs/fotos-modelos.md`).toContain(f.nombre);
      if (f.foto) expect(doc).toContain(`${f.foto}.webp`);
    }
    for (const f of FOTOS_MODELOS.filter((x) => x.foto)) expect(doc).toMatch(new RegExp(`${f.foto}\\.webp[^\\n]*https://`));
  });

  it('rutaFotoModelo busca por nombre sin importar mayusculas', () => {
    expect(rutaFotoModelo('geek bar somax 80k')).toBe('/modelos/geek-bar-somax-80k.webp');
    expect(rutaFotoModelo('Waka Icon 50K')).toBeNull();
    expect(rutaFotoModelo('No existe')).toBeNull();
  });
});
