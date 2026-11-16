import { describe, expect, it } from 'vitest';
import { corregirPromesasDePago, promesaDePago } from '@/dominio/agente/promesa_pago';
import type { RespuestaExtractor } from '@/dominio/agente/intenciones';

const pago = (texto: string): RespuestaExtractor => ({
  acciones: [{ tipo: 'pago', cliente_texto: 'GDL', monto_centavos: 400000, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: texto }],
  sospecha_inyeccion: false, baja_certeza: false,
} as unknown as RespuestaExtractor);

describe('promesa de pago futura', () => {
  it('el caso real: "GDL PAGA el viernes LOS 4,000" es una promesa, no un cobro', () => {
    expect(promesaDePago('GDL PAGA el viernes LOS 4,000')).toBe('el viernes');
    const r = corregirPromesasDePago(pago('GDL PAGA el viernes LOS 4,000'), 'GDL PAGA el viernes LOS 4,000');
    expect(r.acciones[0]).toMatchObject({ tipo: 'cobranza_respuesta', accion: 'prometio', cliente_texto: 'GDL', cuando_texto: 'el viernes', cuenta: null });
  });
  it.each([
    ['dice que paga el jueves', 'el jueves'], ['Ariel pagara el 25', 'el 25'], ['B me paga manana', 'manana'], ['van a pagar la proxima semana', 'la proxima semana'],
    ['quedo de pagar el lunes', 'el lunes'], ['Cliente va a pagar el viernes 4 mil', 'el viernes'],
  ])('promesa: %s', (t, cuando) => expect(promesaDePago(t)).toBe(cuando));
  it.each([
    'GDL pago 4,000', 'ya pago GDL el viernes', 'me deposito GDL 4000', 'GDL pago el viernes pasado 4 mil', 'ya cayo lo de GDL', 'GDL me transfirio 4,000 hoy', 'pague a Karen el viernes', 'cuanto debe GDL',
  ])('NO es promesa (pago hecho o sin futuro): %s', (t) => expect(promesaDePago(t)).toBeNull());
  it('un pago ya hecho no se toca', () => {
    const r = pago('ya pago GDL 4,000 el viernes');
    expect(corregirPromesasDePago(r, 'ya pago GDL 4,000 el viernes')).toBe(r);
  });
  it('solo cambia las acciones pago; las demas quedan igual', () => {
    const r = { ...pago('x'), acciones: [...pago('x').acciones, { tipo: 'consulta', tema: 'por_cobrar' }] } as unknown as RespuestaExtractor;
    const c = corregirPromesasDePago(r, 'GDL paga el viernes');
    expect(c.acciones.map((a) => a.tipo)).toEqual(['cobranza_respuesta', 'consulta']);
  });
});
