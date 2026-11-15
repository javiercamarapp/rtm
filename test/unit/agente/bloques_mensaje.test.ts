import { describe, expect, it } from 'vitest';
import { contarLineas, dividirEnBloques, resumenDeLote } from '@/dominio/agente/bloques_mensaje';

const lote = (n: number, encabezado = 'pedidos de hoy:') => [encabezado, ...Array.from({ length: n }, (_, i) => `${i + 1}) Cliente ${i} 10 zafiro 5k mango`)].join('\n');

describe('bloques de un mensaje largo', () => {
  it('un mensaje corto es un solo bloque, tal cual', () => {
    const t = lote(5);
    const b = dividirEnBloques(t);
    expect(b).toHaveLength(1);
    expect(b[0]!.texto).toBe(t);
  });

  it('120 renglones: ninguna linea se pierde, el encabezado se repite y cada bloque respeta el tope', () => {
    const t = lote(120);
    const b = dividirEnBloques(t, { maxLineas: 40 });
    expect(b.length).toBeGreaterThanOrEqual(3);
    const cuerpo = b.flatMap((x) => x.lineas.filter((l) => l !== 'pedidos de hoy:'));
    expect(cuerpo).toHaveLength(120);
    expect(new Set(cuerpo).size).toBe(120);
    for (const x of b) {
      expect(x.lineas[0]).toBe('pedidos de hoy:');
      expect(x.lineas.length).toBeLessThanOrEqual(40);
    }
    expect(b[1]!.desde).toBe(41); // la linea 1 es el encabezado: el primer bloque lleva las lineas 2 a 40
  });

  it('sin encabezado tambien divide, y por caracteres', () => {
    const lineas = Array.from({ length: 30 }, (_, i) => `Cliente ${i} ${'x'.repeat(200)}`).join('\n');
    const b = dividirEnBloques(lineas, { maxLineas: 100, maxCaracteres: 1500 });
    expect(b.length).toBeGreaterThan(3);
    expect(b.flatMap((x) => x.lineas)).toHaveLength(30);
    for (const x of b) expect(x.texto.length).toBeLessThanOrEqual(1500 + 250);
  });

  it('el resumen cuenta cada linea y avisa si alguna quedo sin respuesta', () => {
    expect(contarLineas('a\n\n b \n')).toBe(2);
    expect(resumenDeLote({ lineasRecibidas: 10, registradas: 8, preguntadas: 1, noEntendidas: 1 })).toBe('Recibi 10 lineas: registre 8, pregunte 1, no entendi 1.');
    expect(resumenDeLote({ lineasRecibidas: 10, registradas: 7, preguntadas: 1, noEntendidas: 1 })).toContain('sin respuesta 1');
  });
});
