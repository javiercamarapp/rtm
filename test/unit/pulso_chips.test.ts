// El pulso viaja de la base como JSON y las claves *_cent se convierten a bigint (dominio/operacion/json). Esta prueba usa la forma real de api.pulso():
// una clave de monto que no termine en _cent llegaria como number y rompería el formato en pantalla.
import { describe, expect, it } from 'vitest';
import type { Pulso } from '@/dominio/notificaciones/tipos';
import { centavosABigint } from '@/dominio/operacion/json';
import { chipsPulso } from '@/ui/shell/pulso';

const real = { por_pagar_isaac_cent: 1250000, por_cobrar_cent: 842000, entre_socios: { socio: 'Angelo', diferencia_cent: 31050 }, en_bodega: { piezas: 1524, valor_cent: 13951645 } };

describe('chips del pulso', () => {
  it('formatea los cuatro indicadores desde la forma real de la base', () => {
    const chips = chipsPulso(centavosABigint<Pulso>(real));
    expect(chips.map((c) => c.texto)).toEqual(['$12,500.00', '$8,420.00', 'Angelo +$310.50', '1,524 pz · $139,516.45']);
  });
  it('sin hechos todos dicen Sin dato (null), nunca cero', () => {
    const chips = chipsPulso(centavosABigint<Pulso>({ por_pagar_isaac_cent: null, por_cobrar_cent: null, entre_socios: null, en_bodega: null }));
    expect(chips.map((c) => c.texto)).toEqual([null, null, null, null]);
    expect(chipsPulso(null).map((c) => c.texto)).toEqual([null, null, null, null]);
  });
  it('una diferencia de cero entre socios dice En paz', () => {
    const chips = chipsPulso(centavosABigint<Pulso>({ ...real, entre_socios: { socio: 'Javier', diferencia_cent: 0 } }));
    expect(chips[2]!.texto).toBe('En paz');
  });
});
