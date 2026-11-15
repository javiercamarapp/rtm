import { describe, expect, it } from 'vitest';
import { instruccionDeIntencion, OPERACIONES_POR_CONVERSACION } from '@/dominio/agente/slots_desde_intencion';
import { intencionDeSlots } from '@/aplicacion/agente/slots_a_intencion';
import { slotsFaltantes } from '@/dominio/agente/slots';

describe('puente interprete -> slots -> intencion', () => {
  it('un pedido sin plazo ni envio deja esos slots vacios (el bot pregunta) y manda solo lo que el modelo extrajo', () => {
    const r = instruccionDeIntencion({ tipo: 'pedido', cliente_texto: 'Lupita', destino_texto: null, lineas: [{ modelo_texto: 'nexa', sabor_texto: 'mango', piezas: 24, precio_texto: null, fuente_cita: 'x' }], envio_cobrado_centavos: null, fuente_cita: 'x' })!;
    expect(r.operacion).toBe('pedido_bodega');
    expect(Object.keys(r.candidatos).sort()).toEqual(['cliente', 'lineas']);
  });
  it('credito a 15 dias y sin envio (0) llegan como modalidad, plazo y envio', () => {
    const r = instruccionDeIntencion({ tipo: 'pedido', cliente_texto: 'Lupita', destino_texto: null, lineas: [], envio_cobrado_centavos: 0, plazo_dias: 15, fuente_cita: 'x' })!;
    expect(r.candidatos).toMatchObject({ modalidad: 'credito', plazo: '15 dias', envio: 0 });
  });
  it('el pago a proveedor de un cliente es pago redirigido; el capital no se manda si paga la sociedad', () => {
    expect(instruccionDeIntencion({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 100, pagado_por: 'sociedad', cliente_texto: 'Ana', fuente_cita: 'x' })!.operacion).toBe('pago_redirigido');
    const r = instruccionDeIntencion({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 100, pagado_por: 'sociedad', cliente_texto: null, intencion: 'capital', fuente_cita: 'x' })!;
    expect(r.candidatos).not.toHaveProperty('intencion');
  });
  it('las consultas y los comandos sin puente no pasan por la conversacion', () => {
    expect(instruccionDeIntencion({ tipo: 'ninguna' })).toBeNull();
    for (const o of OPERACIONES_POR_CONVERSACION) expect(typeof o).toBe('string');
  });
  it('slots completos de un cobro se traducen a la intencion con los ids ya elegidos', () => {
    const slots = { cliente: { id: '7', nombre: 'Ana' }, monto: 100000, cuenta: 'efectivo' };
    expect(slotsFaltantes('cobro_cliente', slots)).toEqual([]);
    const t = intencionDeSlots('cobro_cliente', slots, 'Ana pago 1000');
    expect(t).toMatchObject({ ok: true, intencion: { tipo: 'pago', monto_centavos: 100000, cuenta_destino_texto: 'Efectivo' }, overrides: { cliente: '7' } });
  });
  it('un pedido de contado y uno a credito traducen el plazo; faltando datos se rechaza', () => {
    const base = { cliente: { id: '7', nombre: 'Ana' }, lineas: [{ modeloId: 'm1', modelo: 'Nexa', saborId: 's1', sabor: 'Mango', piezas: 24 }], envio: 0 };
    expect(intencionDeSlots('pedido_bodega', { ...base, modalidad: 'contado', plazo: 0 }, 'x')).toMatchObject({ ok: true, intencion: { tipo: 'pedido', plazo_dias: 0, envio_cobrado_centavos: 0 }, overrides: { cliente: '7', 'lineas.0.modelo': 'm1', 'lineas.0.sabor': 's1' } });
    expect(intencionDeSlots('pedido_bodega', { ...base, modalidad: 'credito', plazo: 15 }, 'x')).toMatchObject({ ok: true, intencion: { plazo_dias: 15 } });
    expect(intencionDeSlots('pedido_bodega', { ...base }, 'x').ok).toBe(false);
    expect(intencionDeSlots('devolucion', {}, 'x').ok).toBe(false);
  });
});
