// El esquema de "Explicar este numero" debe aceptar TODAS las formas que devuelve api.explicar_historial (incluida la del acta sin segunda via,
// donde la base omite `comprobacion`) y nunca dejar pasar un `cuadra` nulo como si fuera verdadero.
import { describe, expect, it } from 'vitest';
import { explicacion } from '@/infra/supabase/lector-catalogo';

const base = { cifra: 'historial:parte:7:Angelo', titulo: 'Parte de Angelo', unidad: 'mxn', valor: 600000, movimientos: [], renglones: [{ concepto: 'Su parte', monto_cent: 600000 }] };

describe('esquema de la explicacion del historial', () => {
  it('con dos vias reales lee la comprobacion', () => {
    const e = explicacion.parse({ ...base, comprobacion: { via1: 'a', via1_valor: 600000, via2: 'b', via2_valor: 600000, cuadra: true } });
    expect(e.comprobacion).toEqual({ via1: 'a', via1Valor: 600000, via2: 'b', via2Valor: 600000, cuadra: true });
  });
  it('sin la clave (acta sin segunda via) no hay comprobacion y no rompe', () => {
    expect(explicacion.parse(base).comprobacion).toBeNull();
  });
  it('con valores nulos se lee como sin comprobacion, no como cuadra', () => {
    const e = explicacion.parse({ ...base, comprobacion: { via1: 'a', via1_valor: 600000, via2: 'b', via2_valor: null, cuadra: null } });
    expect(e.comprobacion).toBeNull();
  });
  it('acepta valores en centavos grandes y negativos (valuacion con perdida)', () => {
    const e = explicacion.parse({ ...base, cifra: 'historial:valor:Javier', valor: -250000, comprobacion: { via1: 'a', via1_valor: -250000, via2: 'b', via2_valor: -250000, cuadra: true } });
    expect(e.valor).toBe(-250000);
    expect(e.comprobacion?.cuadra).toBe(true);
  });
});
