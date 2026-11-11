import { describe, it, expect } from 'vitest';
import { ACCIONES, CAPACIDADES, puede } from '@/dominio/capacidades';

describe('capacidades accion x rol', () => {
  it('en M1 los socios ven todo y Omar nada; sin rol, nada', () => {
    for (const a of ACCIONES) {
      expect(puede('socio', a)).toBe(true);
      expect(puede('omar', a)).toBe(false);
      expect(puede(null, a)).toBe(false);
    }
  });
  it('toda accion tiene entrada en la tabla', () => {
    expect(Object.keys(CAPACIDADES).sort()).toEqual([...ACCIONES].sort());
  });
});
