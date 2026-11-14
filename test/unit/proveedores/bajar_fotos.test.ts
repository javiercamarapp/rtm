import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { claveFoto, ejecutar, extraerModelos, optimizar, renderMapa, reglasRobots, MAX_BYTES } from '../../../scripts/proveedores/bajar-fotos.mjs';
import { claveFoto as claveTs } from '@/config/fotos_karen';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });

const BASE = 'https://fuente.invalido.test';
async function png(ancho: number, alto: number) {
  // Degradado con algo de grano: grande como PNG, pero cabe en 150 KB como webp.
  const raw = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = ((i / 3) % ancho) / ancho * 255 + ((i * 2654435761) >>> 29);
  return sharp(raw, { raw: { width: ancho, height: alto, channels: 3 } }).withMetadata({ exif: { IFD0: { Copyright: 'dato personal' } } }).png().toBuffer();
}

describe('reglas de robots', () => {
  it('Disallow, Allow mas especifico y comodines', () => {
    const p = reglasRobots('User-agent: *\nDisallow: /cart\nDisallow: /*?q=\nAllow: /cart/ok\n');
    expect(p('/products.json?limit=250')).toBe(true);
    expect(p('/cart')).toBe(false);
    expect(p('/cart/ok')).toBe(true);
    expect(p('/x?q=1')).toBe(false);
  });
  it('un robots ilegible permite lo publico', () => { expect(reglasRobots('')('/products.json')).toBe(true); });
});

describe('extraccion y claves', () => {
  it('solo handle, titulo e imagen: descarta precios y variantes', () => {
    const r = extraerModelos({ products: [{ handle: 'Elf-Bar BC5000', title: 'Elf Bar', images: [{ src: 'https://cdn.invalido.test/a.png' }], variants: [{ price: '99.00' }] }, { handle: 'sin-imagen', images: [] }] });
    expect(r).toEqual([{ clave: 'elf-bar-bc5000', titulo: 'Elf Bar', src: 'https://cdn.invalido.test/a.png' }]);
    expect(JSON.stringify(r)).not.toContain('price');
  });
  it('la clave del script es la misma que la del codigo', () => {
    for (const h of ['Elf-Bar_BC5000', 'Sandía 8K', ' x ']) expect(claveFoto(h)).toBe(claveTs(h));
  });
  it('el mapa se escribe ordenado y tipado', () => {
    const t = renderMapa({ b: '/proveedores/karen/b.webp', a: '/proveedores/karen/a.webp' });
    expect(t.indexOf("'a'")).toBeLessThan(t.indexOf("'b'"));
    expect(t).toContain('export const FOTOS_KAREN: Readonly<Record<string, string>>');
  });
});

describe('optimizar', () => {
  it('webp de maximo 800 px, menos de 150 KB y sin metadatos', async () => {
    const out = await optimizar(sharp, await png(1600, 1200));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(800);
    expect(out.length).toBeLessThan(MAX_BYTES);
    expect(meta.exif).toBeUndefined();
  });
});

describe('ejecutar (sin red)', () => {
  const armar = () => {
    const dir = mkdtempSync(join(tmpdir(), 'fotos-'));
    dirs.push(dir);
    const pedidos: { url: string; ua: string }[] = [];
    const t0: number[] = [];
    let imagen: Buffer;
    const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
      pedidos.push({ url, ua: init.headers['User-Agent']! });
      t0.push(Date.now());
      const u = new URL(url);
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /cart\n');
      if (u.pathname === '/products.json') return Response.json({ products: [{ handle: 'modelo-uno', title: 'Uno', images: [{ src: 'https://cdn.invalido.test/uno.png' }], variants: [{ price: '1' }] }, { handle: 'modelo-dos', title: 'Dos', images: [{ src: 'https://cdn.invalido.test/dos.png' }] }] });
      return new Response(new Uint8Array(imagen!), { status: 200 });
    };
    const esperas: number[] = [];
    const dormir = async (ms: number) => { esperas.push(ms); };
    return { dir, pedidos, fetchFn, dormir, esperas, poner: (b: Buffer) => { imagen = b; } };
  };

  it('baja cada imagen una sola vez, con agente generico, pausa de 1 s y mapa sin la direccion', async () => {
    const a = armar();
    a.poner(await png(900, 900));
    const mapa = join(a.dir, 'fotos_karen.ts');
    const log: string[] = [];
    const r = await ejecutar({ base: BASE, fetchFn: a.fetchFn as never, sharp, dormir: a.dormir, dirFotos: join(a.dir, 'f'), archivoMapa: mapa, log: (x: string) => log.push(x) });
    expect(r.estado).toBe('ok');
    expect(r.descargadas).toBe(2);
    expect(readdirSync(join(a.dir, 'f')).sort()).toEqual(['modelo-dos.webp', 'modelo-uno.webp']);
    const t = readFileSync(mapa, 'utf8');
    expect(t).toContain("'modelo-uno': '/proveedores/karen/modelo-uno.webp'");
    expect(t).not.toContain('invalido');
    expect(log.join('\n')).not.toContain('invalido');
    expect(a.esperas.length).toBeGreaterThan(0);
    // La espera es lo que falta para completar 1.1 s desde la ultima peticion (la prueba no depende de la carga de la maquina).
    expect(a.esperas.every((ms) => ms > 0 && ms <= 1100)).toBe(true);
    expect(a.pedidos.every((p) => p.ua === 'RTM-inventario/1.0 (catalogo publico, lectura unica de imagenes)' && !/@|\d{7,}/.test(p.ua))).toBe(true);
    // Segunda corrida: no vuelve a pedir ninguna imagen.
    const antes = a.pedidos.length;
    const r2 = await ejecutar({ base: BASE, fetchFn: a.fetchFn as never, sharp, dormir: a.dormir, dirFotos: join(a.dir, 'f'), archivoMapa: mapa, log: () => undefined });
    expect(r2.descargadas).toBe(0);
    expect(a.pedidos.slice(antes).some((p) => p.url.includes('.png'))).toBe(false);
  });

  it('modo seco solo lee robots y catalogo', async () => {
    const a = armar();
    const r = await ejecutar({ base: BASE, fetchFn: a.fetchFn as never, sharp, dormir: a.dormir, dirFotos: join(a.dir, 'f'), archivoMapa: join(a.dir, 'm.ts'), seco: true, log: () => undefined });
    expect(r.estado).toBe('seco');
    expect(r.peticiones).toBe(2);
    expect(existsSync(join(a.dir, 'f'))).toBe(false);
  });

  it('si robots no permite el catalogo no baja nada', async () => {
    const a = armar();
    const f = async (url: string, i: never) => (new URL(url).pathname === '/robots.txt' ? new Response('User-agent: *\nDisallow: /products.json\n') : a.fetchFn(url, i));
    const r = await ejecutar({ base: BASE, fetchFn: f as never, sharp, dormir: a.dormir, dirFotos: join(a.dir, 'f'), archivoMapa: join(a.dir, 'm.ts'), log: () => undefined });
    expect(r.estado).toBe('robots');
  });
});
