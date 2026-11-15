// Piezas puras del carril de conversacion: montos con k o mil, correcciones, desambiguacion, folio por iniciales y espejo SQL de los slots.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectarCorreccion } from '@/dominio/agente/correcciones';
import { elegirCandidato, textoListaNumerada } from '@/dominio/agente/desambiguacion';
import { esFolioPedido, formatearFolioPedido, inicialesCliente } from '@/dominio/agente/folio_pedido';
import { interpretarMonto, montoDeExtraccion, respuestaSiNo } from '@/dominio/agente/monto_conversacion';
import { OPERACIONES, OPERACIONES_CONV, filasEspejoSql, slotsFaltantes } from '@/dominio/agente/slots';

describe('interpretarMonto', () => {
  it('cifra completa se acepta; k, mil y palabras se piden confirmar; ambiguo se rechaza; sin tope', () => {
    expect(interpretarMonto('12,500')).toEqual({ tipo: 'ok', centavos: 1250000 });
    expect(interpretarMonto('$1,250.50')).toEqual({ tipo: 'ok', centavos: 125050 });
    expect(interpretarMonto('20k')).toEqual({ tipo: 'confirmar', centavos: 2000000, motivo: 'sufijo' });
    expect(interpretarMonto('20 mil')).toEqual({ tipo: 'confirmar', centavos: 2000000, motivo: 'sufijo' });
    expect(interpretarMonto('veinte mil')).toEqual({ tipo: 'confirmar', centavos: 2000000, motivo: 'palabras' });
    expect(interpretarMonto('1.250')).toEqual({ tipo: 'ambiguo' });
    expect(interpretarMonto('mucho dinero')).toEqual({ tipo: 'sin_cifra' });
    expect(interpretarMonto('9,999,999,999')).toMatchObject({ tipo: 'ok' });
    expect(interpretarMonto('sin envio', { permitirCero: true })).toEqual({ tipo: 'ok', centavos: 0 });
    expect(interpretarMonto('sin envio')).toEqual({ tipo: 'sin_cifra' });
  });
  it('un monto del extractor se contrasta con el mensaje original', () => {
    expect(montoDeExtraccion('Ariel pago 20k', 2000000)).toEqual({ tipo: 'confirmar', centavos: 2000000, motivo: 'sufijo' });
    expect(montoDeExtraccion('Ariel pago 12,500', 1250000)).toEqual({ tipo: 'ok', centavos: 1250000 });
    expect(montoDeExtraccion('Ariel pago bastante', 1250000)).toEqual({ tipo: 'sin_cifra' });
  });
  it('si y no', () => {
    expect(respuestaSiNo('sí')).toBe('si');
    expect(respuestaSiNo('si, son 20,000')).toBe('si');
    expect(respuestaSiNo('no')).toBe('no');
    expect(respuestaSiNo('no son 20,000')).toBe('no');
    expect(respuestaSiNo('quizas')).toBeNull();
  });
});

describe('detectarCorreccion', () => {
  const slots = OPERACIONES.cobro_cliente.slots;
  it('cancelar, modalidad, slot nombrado y ultimo dato', () => {
    expect(detectarCorreccion('cancela', slots)).toEqual({ tipo: 'cancelar' });
    expect(detectarCorreccion('mejor a credito', slots)).toEqual({ tipo: 'modalidad', valor: 'credito' });
    expect(detectarCorreccion('mejor de contado', slots)).toEqual({ tipo: 'modalidad', valor: 'contado' });
    expect(detectarCorreccion('cambia el monto a 5,000', slots)).toEqual({ tipo: 'slot', slot: 'monto', texto: '5,000' });
    expect(detectarCorreccion('no, era Ariel', slots)).toEqual({ tipo: 'ultimo', texto: 'Ariel' });
    expect(detectarCorreccion('el monto es 7,000', slots)).toEqual({ tipo: 'slot', slot: 'monto', texto: '7,000' });
    expect(detectarCorreccion('efectivo', slots)).toBeNull();
    expect(detectarCorreccion('no', slots)).toBeNull();
  });
});

describe('desambiguacion', () => {
  const c = [{ id: 'a', nombre: 'Memo Garcia' }, { id: 'b', nombre: 'Memo Lopez' }];
  it('lista numerada con aviso de saldo y eleccion por numero o nombre', () => {
    const t = textoListaNumerada('¿Cual?', [{ ...c[0]!, saldoCent: 150000n }, { ...c[1]!, saldoCent: 0n }]);
    expect(t).toBe('¿Cual?\n1. Memo Garcia (debe $1,500.00)\n2. Memo Lopez (sin saldo)\nResponde con el número o con el nombre.');
    expect(elegirCandidato('2', c)?.id).toBe('b');
    expect(elegirCandidato('el primero', c)?.id).toBe('a');
    expect(elegirCandidato('Memo Lopez', c)?.id).toBe('b');
    expect(elegirCandidato('lopez', c)?.id).toBe('b');
    expect(elegirCandidato('memo', c)).toBeNull();
    expect(elegirCandidato('9', c)).toBeNull();
  });
});

describe('folio por iniciales (espejo de SQL)', () => {
  it('mismas reglas que operacion.iniciales_cliente', () => {
    expect(inicialesCliente('Memo Garcia')).toBe('MG');
    expect(inicialesCliente('Lupita')).toBe('LU');
    expect(inicialesCliente('  Ángel   Núñez ')).toBe('AN');
    expect(inicialesCliente('María del Carmen Ruiz')).toBe('MC');
    expect(inicialesCliente('X')).toBe('XX');
    expect(inicialesCliente('')).toBe('XX');
    expect(formatearFolioPedido('MG', 7)).toBe('MG-007');
    expect(formatearFolioPedido('MG', 1234)).toBe('MG-1234');
    expect(esFolioPedido('MG-001')).toBe(true);
    expect(esFolioPedido('P-0012')).toBe(true);
    expect(esFolioPedido('PEDIDO')).toBe(false);
  });
});

describe('slots: espejo SQL', () => {
  const sql = readFileSync('supabase/migrations/20261116200000_agente_conversacion.sql', 'utf8') + readFileSync('supabase/migrations/20261116300100_ventas_bot_puertas.sql', 'utf8');
  const filas = [...sql.matchAll(/\('([a-z_]+)', (\d+), '([a-z_]+)', true, (null|'[a-z_]+'), (null|array\[[^\]]*\])\)/g)].map((m) => ({
    operacion: m[1]!, orden: Number(m[2]), slot: m[3]!, si_slot: m[4] === 'null' ? null : m[4]!.slice(1, -1),
    si_valor: m[5] === 'null' ? null : [...m[5]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!),
  }));
  it('la tabla agente.operacion_slot coincide con src/dominio/agente/slots.ts (obligatorios, orden y condiciones)', () => {
    expect(filas).toEqual(filasEspejoSql());
  });
  it('cada operacion tiene al menos un slot obligatorio y sus slots condicionales apuntan a slots que existen', () => {
    for (const op of OPERACIONES_CONV) {
      const def = OPERACIONES[op];
      expect(def.slots.some((s) => s.obligatorio)).toBe(true);
      for (const s of def.slots) if (s.si) expect(def.slots.some((x) => x.clave === s.si!.slot), `${op}.${s.clave}`).toBe(true);
    }
  });
  it('slotsFaltantes: el credito exige plazo, el pago de un socio pregunta capital o reembolso, y la aportacion nunca asume capital', () => {
    expect(slotsFaltantes('pedido_bodega', { modalidad: 'credito' })).toContain('plazo');
    expect(slotsFaltantes('pedido_bodega', { modalidad: 'contado' })).not.toContain('plazo');
    expect(slotsFaltantes('pago_proveedor', { pagado_por: 'javier' })).toContain('intencion');
    expect(slotsFaltantes('pago_proveedor', { pagado_por: 'sociedad' })).not.toContain('intencion');
    expect(slotsFaltantes('aportacion', { socio: 'angelo', monto: 1 })).toEqual(['intencion']);
  });
});
