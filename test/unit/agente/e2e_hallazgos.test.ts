// Hallazgo ALTO-1 de la campana E2E maestra (13-nov): '/saldo isaac' y '/saldo karen' no respondian con base real porque la resolucion nunca llevaba al proveedor; '/saldo con Karen' buscaba un cliente.
import { describe, expect, it } from 'vitest';
import { resolverAccion } from '@/aplicacion/agente/resolucion';
import type { CatalogoAgente } from '@/aplicacion/agente/puertos';
import { parsearComando } from '@/dominio/agente/comandos';
import type { Miembro } from '@/dominio/agente/tipos';
import { consulta } from './ayudas';

const javier: Miembro = { telegramUserId: 7_000_002, persona: 'javier', rol: 'socio' };
const sinCatalogo = {} as CatalogoAgente; // la cuenta con un proveedor no consulta el catalogo de clientes ni de modelos

describe('A1: /saldo <proveedor> resuelve al proveedor', () => {
  it.each([['isaac', 'isaac'], ['Karen', 'karen'], ['vapemate', 'karen']])('la consulta saldo_proveedor de "%s" lleva proveedorId=%s', async (texto, id) => {
    const r = await resolverAccion(consulta('saldo_proveedor', { sujeto_texto: texto }), javier, sinCatalogo);
    expect(r.ok && r.resuelta.resoluciones.proveedorId).toBe(id);
  });
  it('un sujeto que no es proveedor se pregunta, no se inventa', async () => {
    const r = await resolverAccion(consulta('saldo_proveedor', { sujeto_texto: 'zorro' }), javier, sinCatalogo);
    expect(r.ok).toBe(false);
  });
  it("'/saldo con Karen' y '/saldo de Isaac' son la cuenta con el proveedor, no un cliente llamado 'con Karen'", () => {
    expect(parsearComando('/saldo con Karen')).toMatchObject({ ok: true, intencion: { consulta: 'saldo_proveedor', sujeto_texto: 'Karen' } });
    expect(parsearComando('/saldo de Isaac')).toMatchObject({ ok: true, intencion: { consulta: 'saldo_proveedor', sujeto_texto: 'Isaac' } });
    expect(parsearComando('/saldo Villa Norte')).toMatchObject({ ok: true, intencion: { consulta: 'saldo', sujeto_texto: 'Villa Norte' } });
  });
});
