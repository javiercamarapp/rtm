import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARCAS, PIE_DE_MARCAS } from '@/dominio/marcas';

const DIR = join(process.cwd(), 'public', 'marcas');
const manifiesto = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { marcas: Record<string, { archivos: Record<string, { sha256: string; viewBox?: string }> }> };

describe('logos oficiales de los servicios', () => {
  it('cada archivo existe, coincide con el sha256 del manifiesto y es el original (nunca recoloreado)', () => {
    for (const [slug, m] of Object.entries(manifiesto.marcas)) {
      for (const [archivo, e] of Object.entries(m.archivos)) {
        const bytes = readFileSync(join(DIR, slug, archivo));
        expect(createHash('sha256').update(bytes).digest('hex'), `${slug}/${archivo}`).toBe(e.sha256);
      }
    }
  });
  it('los SVG no traen scripts, controladores de eventos, referencias externas, filtros ni transformaciones', () => {
    for (const slug of readdirSync(DIR).filter((d) => !d.endsWith('.json'))) {
      for (const f of readdirSync(join(DIR, slug)).filter((x) => x.endsWith('.svg'))) {
        const t = readFileSync(join(DIR, slug, f), 'utf8');
        expect(t, `${slug}/${f}`).not.toMatch(/<script|\son\w+=|foreignObject|<image|<use|<a[\s>]|<iframe|javascript:|xlink:href|href="http|url\(http|@import|<filter|filter=/i);
        const vb = /viewBox="([^"]+)"/.exec(t)?.[1];
        expect(vb, `${slug}/${f}`).toBe(manifiesto.marcas[slug]!.archivos[f]!.viewBox);
      }
    }
  });
  it('cada marca del dominio apunta a archivos que existen: negro en tema claro, blanco en oscuro', () => {
    for (const m of Object.values(MARCAS)) {
      for (const a of [m.claro, m.oscuro, m.icono].filter((x): x is string => x !== null)) expect(existsSync(join(DIR, m.slug, a)), `${m.slug}/${a}`).toBe(true);
      if (m.claro) expect(m.claro).toBe('negro.svg');
      if (m.oscuro) expect(m.oscuro).toBe('blanco.svg');
    }
  });
  it('Telegram solo con su nombre en texto y Higgsfield con su icono junto al nombre', () => {
    expect(MARCAS['telegram']).toBeUndefined();
    expect(MARCAS['higgsfield']!.icono).toBe('icono.png');
  });
  it('el pie de marcas incluye la atribucion literal que exige Vercel y no sugiere patrocinio', () => {
    expect(PIE_DE_MARCAS).toContain('Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries.');
    expect(PIE_DE_MARCAS).not.toMatch(/oficial|patrocinado|partner/i);
  });
});
