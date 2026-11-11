// T02 y T03 de la matriz: entrada de montos y enteros de los formularios (centavosDeTexto) y del dominio (centavosDesdeTexto).
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('@/app/(socio)/operacion/acciones', () => ({ ejecutar: async () => ({ ok: true, datos: {} }) }));

const { centavosDeTexto } = await import('@/app/(socio)/operacion/usar-accion');
const { centavosDesdeTexto } = await import('@/dominio/dinero');

describe('T02 montos validos', () => {
  it.each([
    ['9000', 900_000], ['9,000.50', 900_050], ['$1,234', 123_400], [' 12 ', 1_200], ['0.5', 50], ['1234.5', 123_450], ['$ 1 234.00', 123_400],
  ])('%s -> %i centavos', (txt, esperado) => {
    expect(centavosDeTexto(txt)).toBe(esperado);
  });
  it('14 digitos de pesos caben en centavos seguros', () => {
    expect(centavosDeTexto('90071992547409')).toBe(9_007_199_254_740_900);
  });
});

describe('T02 montos invalidos (el formulario muestra "Escribe un monto valido")', () => {
  it.each(['-5', '9000.505', 'abc', '1e3', '9.', '.5', '', '   ', '$', '1.2.3', '12 pesos'])('%j -> null', (txt) => {
    expect(centavosDeTexto(txt)).toBeNull();
  });
  it('16 digitos de pesos se rechazan (fuera de rango seguro)', () => {
    expect(centavosDeTexto('9999999999999999')).toBeNull();
  });
  it('cero es valido para el parser pero el formulario lo rechaza aparte (0 y 0.00 devuelven 0)', () => {
    expect(centavosDeTexto('0')).toBe(0);
    expect(centavosDeTexto('0.00')).toBe(0);
  });
  it('negativo en el dominio sigue siendo representable (cascada?caja=-500, H-30)', () => {
    expect(centavosDesdeTexto('-500')).toBe(-50_000n);
  });
  // ESPERADO-FALLA-HASTA: H-29. La coma se borra sin avisar: "9,5" pasa por $95.00. Lo correcto es rechazar el formato ambiguo.
  it.fails('H-29: "9,5" y "1.234,56" se rechazan por ambiguos', () => {
    expect(centavosDeTexto('9,5')).toBeNull();
    expect(centavosDeTexto('1.234,56')).toBeNull();
  });
});

describe('T02 sin flotantes', () => {
  it('0.1 + 0.2 pesos suman 30 centavos exactos', () => {
    expect((centavosDeTexto('0.10') ?? 0) + (centavosDeTexto('0.20') ?? 0)).toBe(30);
  });
  it('19.99 x 100 no pasa por number con decimales', () => {
    expect(centavosDeTexto('19.99')).toBe(1_999);
    expect(centavosDesdeTexto('1.15')).toBe(115n);
  });
});
