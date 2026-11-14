// Decision del dueno (14-nov): el bot NO escribe un pedido sin plazo; pregunta (de contado o a cuantos dias paga). El plazo lo calcula el codigo, nunca la IA.
// La guarda de la base (P0436) se prueba en pgTAP a12_002; aqui el espejo en memoria con el cfg exigirPlazoPedido encendido (como en produccion).
import { describe, expect, it } from 'vitest';
import { escenario, pedido, unaAccion } from './ayudas';
import { interpretarPlazo } from '@/dominio/agente/plazo_pedido';
import type { Intencion } from '@/dominio/agente/intenciones';

const EXIGE = { config: { exigirPlazoPedido: true } };
const sinPlazo = (extra: Partial<Extract<Intencion, { tipo: 'pedido' }>> = {}): Intencion => pedido('Cliente Norte', [['jupiter', 40]], { plazo_texto: null, ...extra });

describe('pedido de cliente: plazo obligatorio en el bot', () => {
  it('sin plazo no escribe nada y pregunta', async () => {
    const e = escenario([unaAccion(sinPlazo())], EXIGE);
    await e.socio('angelo', 'Cliente Norte 40 jupiter');
    expect(e.ultimoGrupo().texto).toContain('Falta el plazo de pago');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
  it('el socio contesta "de contado" y el pedido se registra', async () => {
    const e = escenario([unaAccion(sinPlazo())], EXIGE);
    await e.socio('angelo', 'Cliente Norte 40 jupiter');
    await e.socio('angelo', 'de contado');
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
  it('contesta "a 15 dias" y se registra; una respuesta ilegible vuelve a preguntar sin escribir', async () => {
    const e = escenario([unaAccion(sinPlazo())], EXIGE);
    await e.socio('angelo', 'Cliente Norte 40 jupiter');
    await e.socio('angelo', 'luego vemos');
    expect(e.ultimoGrupo().texto).toContain('No entendí el plazo');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    await e.socio('angelo', 'a 15 dias');
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
  it('si el mensaje ya trae el plazo, no pregunta', async () => {
    const e = escenario([unaAccion(sinPlazo({ plazo_texto: 'de contado' }))], EXIGE);
    await e.socio('angelo', 'Cliente Norte 40 jupiter de contado');
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
  it('un plazo que el modelo inventa y el mensaje no dice se ignora: pregunta', async () => {
    const e = escenario([unaAccion(sinPlazo({ plazo_texto: 'de contado' }))], EXIGE);
    await e.socio('angelo', 'Cliente Norte 40 jupiter');
    expect(e.ultimoGrupo().texto).toContain('Falta el plazo de pago');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
  it('el comando /pedido sin plazo tambien pregunta; con "plazo contado" no', async () => {
    const e = escenario([], EXIGE);
    await e.socio('angelo', '/pedido Cliente Norte | jupiter 40');
    expect(e.ultimoGrupo().texto).toContain('Falta el plazo de pago');
    const e2 = escenario([], EXIGE);
    await e2.socio('angelo', '/pedido Cliente Norte | jupiter 40 | plazo contado');
    expect(e2.negocio.numeroDeHechos()).toBe(1);
  });
  it('los dias salen del codigo', () => {
    expect(interpretarPlazo('a 15 dias', new Date('2026-11-10T18:00:00Z'))).toEqual({ tipo: 'ok', dias: 15 });
  });
});

describe('reporte "Por pagar" del bot con el renglon de Omar', () => {
  it('/porpagar lista Isaac, Karen y la renta de Omar aparte, con el total', async () => {
    const e = escenario([]);
    e.negocio.ponerSaldoProveedor('karen', -2_000_000n);
    e.negocio.ponerSaldoProveedor('isaac', -5_000_000n);
    await e.socio('angelo', '/porpagar');
    const t = e.ultimoGrupo().texto;
    expect(t).toContain('Isaac: $50,000.00');
    expect(t).toContain('Karen: $20,000.00');
    expect(t).toContain('Renta de Omar');
    expect(t).toContain('Total por pagar: $70,000.00');
  });
});
