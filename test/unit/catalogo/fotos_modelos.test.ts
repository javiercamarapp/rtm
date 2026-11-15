import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FOTOS_MODELOS, MOTIVO_SIN_FOTO, rutaFotoModelo } from '@/dominio/catalogo/fotos-modelos';

const RAIZ = join(__dirname, '..', '..', '..');
const MARCAS = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'catalogo', 'marcas-modelos.json'), 'utf8')) as { modelos: { id: number; nombre: string; marca: string; confianza: string; evidencia: string }[] };

describe('fotos de modelos', () => {
  it('la lista cubre cada modelo activo del catalogo una sola vez (87 al 14-nov)', () => {
    expect(FOTOS_MODELOS.length).toBe(87);
    expect(new Set(FOTOS_MODELOS.map((f) => f.id)).size).toBe(FOTOS_MODELOS.length);
    expect(new Set(FOTOS_MODELOS.map((f) => f.nombre.toLowerCase())).size).toBe(FOTOS_MODELOS.length);
  });

  it('todo modelo tiene foto o declara explicitamente que no la tiene, con su confianza', () => {
    for (const f of FOTOS_MODELOS) {
      expect(f.foto === null || /^\/(modelos|proveedores\/karen)\/[a-z0-9-]+\.webp$/.test(f.foto), `${f.nombre}: ruta invalida`).toBe(true);
      expect(f.confianza === 'sin_evidencia', `${f.nombre}: confianza incoherente con la foto`).toBe(f.foto === null);
      expect(['exacto', 'probable', 'sin_evidencia']).toContain(f.confianza);
    }
    expect(MOTIVO_SIN_FOTO.length).toBeGreaterThan(10);
  });

  it('cada foto declarada existe como webp real, de 800 px o menos y con menos de 150 KB', () => {
    const rutas = new Set(FOTOS_MODELOS.filter((x) => x.foto).map((x) => x.foto as string));
    expect(rutas.size).toBeGreaterThan(30);
    for (const r of rutas) {
      const ruta = join(RAIZ, 'public', r);
      expect(existsSync(ruta), `falta ${r}`).toBe(true);
      expect(statSync(ruta).size, `${r} pesa 150 KB o mas`).toBeLessThan(150 * 1024);
      const b = readFileSync(ruta);
      expect(b.subarray(0, 4).toString()).toBe('RIFF');
      expect(b.subarray(8, 12).toString()).toBe('WEBP');
      expect(b.includes(Buffer.from('EXIF')), `${r} trae metadatos EXIF`).toBe(false);
      expect(b.includes(Buffer.from('XMP ')), `${r} trae metadatos XMP`).toBe(false);
    }
  });

  it('las fotos de la tienda del proveedor se reusan por ruta, sin copiar el archivo a public/modelos', () => {
    for (const f of FOTOS_MODELOS.filter((x) => x.foto?.startsWith('/proveedores/karen/'))) {
      expect(existsSync(join(RAIZ, 'public', 'modelos', (f.foto as string).split('/').pop() as string))).toBe(false);
    }
  });

  it('docs/fotos-modelos.md lista la procedencia de cada foto propia y los modelos sin foto', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'fotos-modelos.md'), 'utf8');
    for (const f of FOTOS_MODELOS) {
      expect(doc, `${f.nombre} no aparece en docs/fotos-modelos.md`).toContain(f.nombre);
      if (f.foto) expect(doc).toContain(`${f.foto.split('/').pop()}`);
    }
    for (const f of FOTOS_MODELOS.filter((x) => x.foto?.startsWith('/modelos/'))) expect(doc).toMatch(new RegExp(`${(f.foto as string).split('/').pop()}[^\\n]*https://`));
  });

  it('la documentacion no contiene la direccion privada del proveedor', () => {
    const textos = ['docs/fotos-modelos.md', 'docs/marcas-por-confirmar.md', 'src/config/fotos_karen.ts'].map((r) => readFileSync(join(RAIZ, r), 'utf8')).join('\n');
    expect(textos).not.toMatch(/myshopify|vapemate|products\.json/i);
  });

  it('rutaFotoModelo busca por nombre sin importar mayusculas', () => {
    expect(rutaFotoModelo('geek bar somax 80k')).toBe('/modelos/geek-bar-somax-80k.webp');
    expect(rutaFotoModelo('Waka Icon 50K')).toBe('/proveedores/karen/waka-icon-50-000.webp');
    expect(rutaFotoModelo('Elux 50K')).toBe('/modelos/elux-50k.webp');
    expect(rutaFotoModelo('No existe')).toBeNull();
  });
});

describe('mapa de marcas de los modelos sin marca', () => {
  it('cada modelo del mapa existe en la tabla de modelos y esta en Sin marca', () => {
    expect(MARCAS.modelos.length).toBe(FOTOS_MODELOS.filter((f) => f.marca === 'Sin marca').length);
    for (const m of MARCAS.modelos) {
      const f = FOTOS_MODELOS.find((x) => x.id === m.id);
      expect(f?.nombre, `id ${m.id}`).toBe(m.nombre);
      expect(f?.marca).toBe('Sin marca');
      expect(['exacto', 'probable']).toContain(m.confianza);
      expect(m.marca.length).toBeGreaterThan(1);
      expect(m.evidencia.length).toBeGreaterThan(20);
    }
  });

  it('los modelos por confirmar estan en docs/marcas-por-confirmar.md', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'marcas-por-confirmar.md'), 'utf8');
    for (const m of MARCAS.modelos.filter((x) => x.confianza !== 'exacto')) expect(doc).toContain(`${m.nombre} (${m.id})`);
  });
});
