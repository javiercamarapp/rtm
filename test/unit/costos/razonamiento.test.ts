import { describe, expect, it } from 'vitest';
import { DESTINO_DEL_DINERO, razonamientoDe, textoCuotaBase } from '@/dominio/costos/razonamiento';

describe('razonamiento de costos', () => {
  it('cada servicio conocido explica por que y como; el destino habla de aportacion de capital sin mover la caja', () => {
    for (const slug of ['openrouter', 'vercel', 'supabase', 'dominio', 'claude_max', 'resend', 'telegram', 'github', 'higgsfield', 'transcripcion']) {
      const r = razonamientoDe(slug);
      expect(r.porQue.length).toBeGreaterThan(10);
      expect(r.comoSeCalcula.length).toBeGreaterThan(10);
    }
    expect(razonamientoDe('claude_max').comoSeCalcula).toContain('20 USD');
    expect(razonamientoDe('dominio').porQue).toContain('Vercel');
    expect(DESTINO_DEL_DINERO).toContain('aportación de capital');
    expect(DESTINO_DEL_DINERO).toContain('sin mover la caja');
  });
  it('la cuota base se narra con su regla y vigencia', () => {
    expect(textoCuotaBase({ regla: 'menor', cuota_orig_micro: 20_000_000, vigente_desde: '2026-11-01', nota: '' })).toBe('Se cobra lo menor entre la cuota base de USD 20.00 y el consumo real (vigente desde 2026-11-01).');
    expect(textoCuotaBase(null)).toBeNull();
  });
});
