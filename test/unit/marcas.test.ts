import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGOS_SERVICIO, PIE_DE_MARCAS } from '@/dominio/marcas';

const DIR = join(process.cwd(), 'public', 'logos');
const manifiesto = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { archivos: Record<string, { sha256: string; origen: string }> };

describe('logos de los servicios', () => {
  it('cada archivo existe, coincide con el sha256 del manifiesto y declara su origen', () => {
    for (const [archivo, e] of Object.entries(manifiesto.archivos)) {
      expect(createHash('sha256').update(readFileSync(join(DIR, archivo))).digest('hex'), archivo).toBe(e.sha256);
      expect(e.origen.length, archivo).toBeGreaterThan(10);
    }
  });
  it('no hay archivos en public/logos fuera del manifiesto, ni logos declarados sin archivo', () => {
    expect(readdirSync(DIR).filter((f) => f !== 'manifest.json').sort()).toEqual(Object.keys(manifiesto.archivos).sort());
    for (const [slug, l] of Object.entries(LOGOS_SERVICIO)) expect(existsSync(join(DIR, l.archivo)), `${slug} -> ${l.archivo}`).toBe(true);
  });
  it('los SVG no traen scripts, controladores de eventos, referencias externas ni filtros', () => {
    for (const f of readdirSync(DIR).filter((x) => x.endsWith('.svg'))) {
      expect(readFileSync(join(DIR, f), 'utf8'), f).not.toMatch(/<script|\son\w+=|foreignObject|<image|<use|<a[\s>]|<iframe|javascript:|xlink:href|href="http|url\(http|@import|<filter|filter=/i);
    }
  });
  it('el icono generico no pretende ser marca y el dominio usa el logo de Vercel (se administra ahi)', () => {
    expect(LOGOS_SERVICIO['transcripcion']!.origen).toBe('generico');
    expect(LOGOS_SERVICIO['dominio']!.archivo).toBe(LOGOS_SERVICIO['vercel']!.archivo);
  });
  it('el pie de marcas incluye la atribucion literal que exige Vercel y no sugiere patrocinio', () => {
    expect(PIE_DE_MARCAS).toContain('Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries.');
    expect(PIE_DE_MARCAS).not.toMatch(/oficial|patrocinado|partner/i);
  });
});
