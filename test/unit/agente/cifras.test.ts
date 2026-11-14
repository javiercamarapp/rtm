import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { RegistroCifras, cifrasDeMonto, cifrasDePiezas, cifrasSinProcedencia, valoresDeTexto } from '@/dominio/agente/cifras';
import { ErrorCifraAjena } from '@/dominio/agente/tipos';

describe('valoresDeTexto (procedencia de cifras de entrada)', () => {
  it('cifras con separadores, decimales, k y mil', () => {
    const v = valoresDeTexto('Villa pago $7,000.50, 1.5k de guia y 15 mil de anticipo, 28pz');
    expect(v.has(700_050n)).toBe(true);
    expect(v.has(150_000n)).toBe(true);
    expect(v.has(1_500_000n)).toBe(true);
    expect(v.has(2_800n)).toBe(true);
  });
  it('palabras en espanol', () => {
    const v = valoresDeTexto('veintiocho jupiter, dos mil quinientos de envio, treinta y cinco mas, mil pesos, cien piezas');
    expect(v.has(2_800n)).toBe(true);
    expect(v.has(250_000n)).toBe(true);
    expect(v.has(3_500n)).toBe(true);
    expect(v.has(100_000n)).toBe(true);
    expect(v.has(10_000n)).toBe(true);
  });
  it('"1.500" admite las dos lecturas (1.5 y 1,500)', () => {
    const v = valoresDeTexto('mande 1.500');
    expect(v.has(150n)).toBe(true);
    expect(v.has(150_000n)).toBe(true);
  });
  it('coma decimal y millones', () => {
    const v = valoresDeTexto('1,5 y 2 millones');
    expect(v.has(150n)).toBe(true);
    expect(v.has(200_000_000n)).toBe(true);
  });
  it('un numero inventado no aparece', () => {
    expect(valoresDeTexto('Villa 28 jupiter').has(3_000n)).toBe(false);
  });
  it('texto sin numeros no produce valores', () => {
    expect(valoresDeTexto('hola, buen dia').size).toBe(0);
  });
});

describe('cifrasSinProcedencia', () => {
  it('detecta la cifra alucinada y deja pasar las del mensaje', () => {
    const fuente = 'Villa: 28 jupiter. Pago 7,000';
    const faltan = cifrasSinProcedencia(fuente, [cifrasDePiezas('lineas.0.piezas', 28), cifrasDeMonto('monto', 700_000), cifrasDePiezas('lineas.1.piezas', 24)]);
    expect(faltan).toEqual(['lineas.1.piezas']);
  });
  it('propiedad: todo numero escrito con cifras en el mensaje tiene procedencia', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2000 }), fc.integer({ min: 1, max: 9_999_999 }), (piezas, pesos) => {
        const fuente = `pedido de ${piezas} piezas, pago ${pesos}`;
        expect(cifrasSinProcedencia(fuente, [cifrasDePiezas('p', piezas), cifrasDeMonto('m', pesos * 100)])).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
  it('propiedad: un monto con separadores de miles tambien tiene procedencia', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1000, max: 9_999_999 }), (pesos) => {
        const conComas = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        expect(cifrasSinProcedencia(`mando ${conComas}`, [cifrasDeMonto('m', pesos * 100)])).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});

describe('RegistroCifras (guardia de salida: ningun numero que no venga del servidor)', () => {
  it('acepta lo registrado, con formato de dinero y piezas', () => {
    const r = new RegistroCifras();
    const texto = `Registrado ${r.folio('P-0123')}: ${r.piezas(28)} por ${r.pesos(700_000n)}`;
    expect(r.auditar(texto)).toEqual([]);
    expect(r.exigir(texto)).toBe(texto);
  });
  it('rechaza un numero ajeno y lo reporta', () => {
    const r = new RegistroCifras();
    const texto = `Total ${r.pesos(700_000n)} y ademas 1,234 de utilidad.`;
    expect(r.auditar(texto)).toEqual(['1,234']);
    expect(() => r.exigir(texto)).toThrow(ErrorCifraAjena);
  });
  it('un numero redactado por el modelo que no se registro se rechaza aunque se parezca', () => {
    const r = new RegistroCifras();
    r.pesos(700_000n);
    expect(r.auditar('Son $7,000.01')).toEqual(['7,000.01']);
  });
  it('cifra() registra cada variante del servidor', () => {
    const r = new RegistroCifras();
    const partes = [
      r.cifra({ tipo: 'pesos', etiqueta: 'a', centavos: 12_345n }),
      r.cifra({ tipo: 'piezas', etiqueta: 'b', piezas: 1524 }),
      r.cifra({ tipo: 'folio', etiqueta: 'c', folio: 'G-0045' }),
      r.cifra({ tipo: 'texto', etiqueta: 'd', texto: 'Waka Jupiter 50K' }),
      r.config(10),
    ];
    expect(r.auditar(partes.join(' | '))).toEqual([]);
  });
  it('los ceros a la izquierda de un folio no engañan, y el punto final se ignora', () => {
    const r = new RegistroCifras();
    r.folio('P-0007');
    expect(r.auditar('Folio P-7.')).toEqual([]);
  });
  it('propiedad: lo que el servidor registra nunca se reporta como ajeno', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -1_000_000_000n, max: 1_000_000_000n }), fc.integer({ min: 0, max: 100_000 }), (c, n) => {
        const r = new RegistroCifras();
        const t = `${r.pesos(c)} ${r.piezas(n)}`;
        expect(r.auditar(t)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  describe('procedencia de PIEZAS (Fase 0a): solo cuentan las cantidades', () => {
    const sin = (texto: string, piezas: number) => cifrasSinProcedencia(texto, [cifrasDePiezas('p', piezas)]);
    it('el sufijo k del modelo no es cantidad ("Zafiro 5K", "Orbita 20K")', () => {
      expect(sin('pedido a costo de zafiro 5k sandia, pago el viernes', 5)).toEqual(['p']);
      expect(sin('dropshipping de orbita 20k mango y uva', 20)).toEqual(['p']);
      expect(sin('12 zafiro 5k sandia', 12)).toEqual([]);
      expect(sin('5 zafiro 5k sandia', 5)).toEqual([]);
    });
    it('"mil" si multiplica en piezas: "2 mil zafiro 5k mango" = 2000, y el 2 suelto no', () => {
      expect(sin('2 mil zafiro 5k mango', 2000)).toEqual([]);
      expect(sin('2 mil zafiro 5k mango', 2)).toEqual(['p']);
      expect(sin('mil zafiro 5k mango', 1000)).toEqual([]);
    });
    it('un folio no es cantidad (P-0012, C-0004)', () => {
      expect(sin('cancela el pedido P-0012', 12)).toEqual(['p']);
      expect(sin('recibi C-0004 completa', 4)).toEqual(['p']);
      expect(sin('recibi C-0004: 30 zafiro 5k sandia', 30)).toEqual([]);
    });
    it('una fecha no es cantidad (15/11, 15/11/2026)', () => {
      expect(sin('pago el 15/11 de zafiro sandia', 15)).toEqual(['p']);
      expect(sin('pago el 15/11 de zafiro sandia', 11)).toEqual(['p']);
      expect(sin('pago el 15/11/2026 de zafiro', 2026)).toEqual(['p']);
      expect(sin('pago el 15/11, 8 zafiro sandia', 8)).toEqual([]);
    });
    it('un porcentaje no es cantidad (10%)', () => {
      expect(sin('con 10% de descuento, zafiro sandia', 10)).toEqual(['p']);
      expect(sin('con 10% de descuento, 6 zafiro sandia', 6)).toEqual([]);
      expect(sin('descuento del 12.5 %: zafiro', 12)).toEqual(['p']);
    });
    it('la numeracion de lista no es cantidad (1) 2) 3))', () => {
      const lote = '1) zafiro sandia, pago el viernes\n2) orbita mango, pago el sabado';
      expect(sin(lote, 1)).toEqual(['p']);
      expect(sin(lote, 2)).toEqual(['p']);
      expect(sin('1) 10 zafiro sandia\n2) 12 orbita mango', 10)).toEqual([]);
      expect(sin('1) 10 zafiro sandia\n2) 12 orbita mango', 2)).toEqual(['p']);
    });
  });

  describe('procedencia de DINERO con sufijo k/mil (Fase 0a)', () => {
    const sin = (texto: string, centavos: number) => cifrasSinProcedencia(texto, [cifrasDeMonto('m', centavos)]);
    it('"20k" solo aporta 20,000 pesos; el 20 sin multiplicar no pasa', () => {
      expect(sin('Cliente Alfa pago orbita 20k', 2000)).toEqual(['m']); // 20 pesos
      expect(sin('Cliente Alfa pago orbita 20k', 2_000_000)).toEqual([]); // 20,000 pesos: unica lectura valida de "20k"
      expect(sin('Cliente Alfa pago orbita 20k', 200)).toEqual(['m']); // 2 pesos
    });
    it('k y mil siguen valiendo para los montos dictados', () => {
      expect(sin('Cliente Gamma me paso 3k', 300_000)).toEqual([]);
      expect(sin('Cliente Gamma me paso 3k', 300)).toEqual(['m']);
      expect(sin('abono 12 mil en efectivo', 1_200_000)).toEqual([]);
      expect(sin('abono 12 mil en efectivo', 1200)).toEqual(['m']);
      expect(sin('pago 1.5k', 150_000)).toEqual([]);
    });
  });
});
