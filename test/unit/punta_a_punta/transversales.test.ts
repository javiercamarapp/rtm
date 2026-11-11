// Casos transversales de la matriz que se pueden afirmar sin navegador ni base: T05 (conversion de centavos), T07 (permisos: un solo negocio),
// T11 (fechas y cortes en hora de Merida), T14 (datos largos y caracteres), T15 (navegacion segura), formato.
import { describe, it, expect } from 'vitest';
import { centavosABigint, bigintACentavos } from '@/dominio/operacion/json';
import { ACCIONES, CAPACIDADES, puede } from '@/dominio/capacidades';
import { diaSemanaLunes0, fechaNeg, semanaLiquidacionProveedor, semanaOmar, semanaReporte, sumarDias } from '@/dominio/calendario';
import { destinoSeguro, rutaPropiaSegura } from '@/dominio/acceso/ruta_segura';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { textoNota } from '@/dominio/nota/texto';
import type { NotaClienteSnap } from '@/dominio/operacion/tipos';

describe('T07 permisos: un solo negocio', () => {
  it('el socio puede todo lo listado; Omar y sin sesion no pueden nada', () => {
    for (const a of ACCIONES) {
      expect(puede('socio', a)).toBe(true);
      expect(puede('omar', a)).toBe(false);
      expect(puede(null, a)).toBe(false);
      expect(puede(undefined, a)).toBe(false);
    }
  });
  it('la tabla de capacidades no distingue entre Angelo y Javier (solo hay rol socio)', () => {
    const roles = new Set(Object.values(CAPACIDADES).flat());
    expect([...roles]).toEqual(['socio']);
  });
});

describe('T11 fechas y cortes (Merida UTC-6 fijo)', () => {
  it('23:59 del domingo 7-mar-2027 en Merida es domingo; 00:01 del lunes ya es lunes', () => {
    expect(fechaNeg(new Date('2027-03-08T05:59:00Z'))).toBe('2027-03-07');
    expect(fechaNeg(new Date('2027-03-08T06:01:00Z'))).toBe('2027-03-08');
  });
  it('semana 1 del plan: lunes 1-mar a domingo 7-mar; corte de Omar lunes 8-mar; liquidacion de Isaac viernes 5-mar', () => {
    expect(semanaReporte('2027-03-03')).toEqual({ inicio: '2027-03-01', fin: '2027-03-07' });
    expect(semanaOmar('2027-03-03').corte).toBe('2027-03-08');
    expect(semanaLiquidacionProveedor('2027-03-03').cierre).toBe('2027-03-05');
    expect(diaSemanaLunes0('2027-03-05')).toBe(4);
  });
  it('el plazo de 5 dias desde el envio del 1-mar vence el 6-mar', () => {
    expect(sumarDias('2027-03-01', 5)).toBe('2027-03-06');
  });
  it('1-mar-2027 es lunes (semilla de los flujos)', () => {
    expect(diaSemanaLunes0('2027-03-01')).toBe(0);
  });
});

describe('T15 navegacion: next externos y rutas absurdas caen al inicio', () => {
  it.each(['https://malo.example/x', '//malo.example', '/pedidos/../../etc', '/pedidos/%2e%2e/x', '/\\malo', '/otra-seccion', 'pedidos', '', '/pedidos\n'])('%j -> /', (v) => {
    expect(destinoSeguro(v)).toBe('/');
  });
  it.each(['/pedidos', '/pedidos/12', '/socios/cascada?caja=0', '/proveedores/liquidacion?semana=2027-03-01', '/avisos#x'])('%s se respeta', (v) => {
    expect(rutaPropiaSegura(v)).toBe(true);
    expect(destinoSeguro(v)).toBe(v);
  });
  it('ruta de 3,000 caracteres se rechaza', () => {
    expect(rutaPropiaSegura(`/pedidos/${'a'.repeat(3000)}`)).toBe(false);
  });
});

describe('T05 conversion de centavos entre base y pantalla', () => {
  it('toda clave *_cent pasa a bigint, incluso anidada y en mapas', () => {
    const r = centavosABigint<{ a: { total_cent: bigint; xs: { monto_cent: bigint }[] }; antiguedad_cent: Record<string, bigint>; piezas: number }>({
      a: { total_cent: 630_000, xs: [{ monto_cent: 5 }] }, antiguedad_cent: { '0-30': 100 }, piezas: 40,
    });
    expect(r.a.total_cent).toBe(630_000n);
    expect(r.a.xs[0]!.monto_cent).toBe(5n);
    expect(r.antiguedad_cent['0-30']).toBe(100n);
    expect(r.piezas).toBe(40);
  });
  it('null se conserva (sin dato) y un decimal en *_cent es error', () => {
    expect(centavosABigint<{ x_cent: null }>({ x_cent: null }).x_cent).toBeNull();
    expect(() => centavosABigint({ x_cent: 1.5 })).toThrow(RangeError);
  });
  it('bigint fuera de rango seguro no viaja a la base', () => {
    expect(() => bigintACentavos(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(RangeError);
    expect(bigintACentavos(-1n)).toBe(-1);
  });
});

describe('T14 caracteres y longitudes', () => {
  const nota = (cliente: string, modelo: string): NotaClienteSnap => ({
    folio: 'P-1', fecha: null, cliente, entrega: 'x', grupos: [],
    lineas_texto: [{ modelo, piezas: 1, precio_cent: 100n, total_cent: 100n }],
    piezas_total: 1, subtotal_cent: 100n, envio_cent: 0n, recargo_cent: 0n, descuento_cent: 0n, total_cent: 100n,
  });
  it('el texto de WhatsApp conserva ñ, acentos, comillas y etiquetas sin interpretarlas', () => {
    const t = textoNota(nota('Peña "El Güero" <script>alert(1)</script>', 'Níñ\'o 50K'));
    expect(t).toContain('Peña "El Güero" <script>alert(1)</script>');
    expect(t).toContain('Níñ\'o 50K 1pz x $1 = 1');
  });
  it('cliente de 120 caracteres no se trunca en el texto', () => {
    const largo = 'C'.repeat(120);
    expect(textoNota(nota(largo, 'M'))).toContain(`Nota ${largo}`);
  });
  it('formato de moneda y piezas con signo real', () => {
    expect(formatearMoneda(-86_050n)).toBe('−$860.50');
    expect(formatearMoneda(123_456_789n)).toBe('$1,234,567.89');
    expect(formatearPiezas(1524)).toBe('1,524 pz');
    expect(() => formatearPiezas(1.5)).toThrow(RangeError);
  });
});
