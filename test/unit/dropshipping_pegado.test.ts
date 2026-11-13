import { describe, expect, it } from 'vitest';
import { parsearPegado } from '@/dominio/dropshipping/pegado';

describe('captura rapida de sabores', () => {
  const validos = ['Fresa', 'Mango', 'Uva', 'Piña'];
  it('entiende varias formas de escribir sabor y cantidad', () => {
    const r = parsearPegado('Fresa 8\nmango x 12\nUva: 10\npiña - 5 pzas', validos);
    expect(r.errores).toEqual([]);
    expect(r.renglones).toEqual([{ sabor: 'Fresa', piezas: 8 }, { sabor: 'Mango', piezas: 12 }, { sabor: 'Uva', piezas: 10 }, { sabor: 'Piña', piezas: 5 }]);
  });
  it('suma el mismo sabor repetido y no adivina los desconocidos', () => {
    const r = parsearPegado('Fresa 4\nFresa 4\nKiwi 3\nnada', validos);
    expect(r.renglones).toEqual([{ sabor: 'Fresa', piezas: 8 }]);
    expect(r.errores).toHaveLength(2);
  });
  it('15 sabores a 8 piezas son 120 piezas', () => {
    const t = Array.from({ length: 15 }, (_, i) => `Sabor ${i + 1} 8`).join('\n');
    const r = parsearPegado(t);
    expect(r.renglones).toHaveLength(15);
    expect(r.renglones.reduce((a, x) => a + x.piezas, 0)).toBe(120);
  });
});
