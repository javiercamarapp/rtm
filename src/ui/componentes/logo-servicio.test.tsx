// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { auditar, fijarModo, montar, type Montaje } from '@/ui/graficas/pruebas/ayudas';
import { LOGOS_SERVICIO, logoDeServicio } from '@/dominio/marcas';
import { LogoServicio } from './logo-servicio';

const montajes: Montaje[] = [];
const abrir = (m: Montaje) => (montajes.push(m), m);
afterEach(() => {
  while (montajes.length) montajes.pop()!.desmontar();
  fijarModo(null);
});

describe('LogoServicio', () => {
  it('con logo: imagen con alt, carga diferida, tamano 36 y sin violaciones de axe', async () => {
    const m = abrir(montar(<LogoServicio slug="github" nombre="GitHub" />, 'reduced'));
    const img = m.cont.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/logos/github.svg');
    expect(img.getAttribute('alt')).toBe('Logo de GitHub');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(m.cont.querySelector('.rtm-logo-serv')?.getAttribute('data-tamano')).toBe('36');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('sin logo: monograma con nombre accesible y sin violaciones de axe', async () => {
    const m = abrir(montar(<LogoServicio slug="servicio_nuevo" nombre="Servicio Nuevo" />, 'reduced'));
    expect(m.cont.querySelector('img')).toBeNull();
    expect(m.cont.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Logo de Servicio Nuevo');
    expect(m.cont.textContent).toBe('SN');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('si la imagen no carga, cambia al monograma', () => {
    const m = abrir(montar(<LogoServicio slug="vercel" nombre="Vercel" tamano={40} />, 'reduced'));
    const img = m.cont.querySelector('img')!;
    act(() => { img.dispatchEvent(new Event('error')); });
    expect(m.cont.querySelector('img')).toBeNull();
    expect(m.cont.querySelector('.rtm-logo-serv-mono')?.getAttribute('data-tamano')).toBe('40');
  });
  it('con nombre: avatar y texto en la misma fila', async () => {
    const m = abrir(montar(<LogoServicio slug="openrouter_comision" nombre="OpenRouter, comisión de recarga" conNombre />, 'reduced'));
    expect(m.cont.querySelector('.rtm-logo-serv-fila .rtm-logo-serv-nombre')?.textContent).toBe('OpenRouter, comisión de recarga');
    expect(m.cont.querySelector('img')?.getAttribute('src')).toBe('/logos/openrouter.svg');
    expect(await auditar(m.cont)).toEqual([]);
  });
  it('sin estilos en linea', () => {
    const m = abrir(montar(<LogoServicio slug="telegram" nombre="Telegram" />, 'reduced'));
    expect(m.cont.querySelectorAll('[style]').length).toBe(0);
  });
});

describe('catalogo de logos', () => {
  const raiz = process.cwd();
  // Slugs de costos.servicio en la migracion de integracion (fuente de verdad del catalogo).
  const sql = readFileSync(join(raiz, 'supabase/migrations/20261110002500_integracion_costos.sql'), 'utf8');
  const bloque = sql.slice(sql.indexOf('insert into costos.servicio'), sql.indexOf('create table costos.tipo_cambio'));
  const servicios = [...bloque.matchAll(/^\s*\('([a-z_]+)', '([^']+)',/gm)].map((x) => ({ slug: x[1]!, nombre: x[2]! }));
  const logosDeLaBase = [...bloque.matchAll(/, (null|'[a-z_]+')\),?;?\s*$/gm)].map((x) => x[1]!);

  it('el catalogo de costos tiene al menos los 11 servicios conocidos', () => {
    expect(servicios.length).toBeGreaterThanOrEqual(11);
    expect(logosDeLaBase.length).toBe(servicios.length);
  });
  it('todo servicio del catalogo tiene logo y su archivo existe y pesa 40 KB o menos', () => {
    for (const s of servicios) {
      const logo = logoDeServicio(s.slug);
      expect(logo, `sin logo para ${s.slug}`).not.toBeNull();
      const ruta = join(raiz, 'public/logos', logo!.archivo);
      expect(existsSync(ruta), `falta ${ruta}`).toBe(true);
      expect(statSync(ruta).size, `${logo!.archivo} pesa de mas`).toBeGreaterThan(100);
      expect(statSync(ruta).size, `${logo!.archivo} pesa de mas`).toBeLessThanOrEqual(40 * 1024);
    }
  });
  it('todo archivo declarado existe', () => {
    for (const [slug, l] of Object.entries(LOGOS_SERVICIO)) expect(existsSync(join(raiz, 'public/logos', l.archivo)), `${slug} -> ${l.archivo}`).toBe(true);
  });
  it('el logo_slug de la base tambien resuelve a un logo', () => {
    for (const l of logosDeLaBase) if (l !== 'null') expect(logoDeServicio(null, l.replaceAll("'", '')), l).not.toBeNull();
  });
  it('los SVG no traen scripts ni manejadores', () => {
    for (const l of Object.values(LOGOS_SERVICIO)) {
      if (!l.archivo.endsWith('.svg')) continue;
      const txt = readFileSync(join(raiz, 'public/logos', l.archivo), 'utf8');
      expect(/<script|\son[a-z]+=|javascript:/i.test(txt), l.archivo).toBe(false);
    }
  });
});
