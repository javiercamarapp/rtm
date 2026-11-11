// La solicitud de piezas: idempotencia, existencia neta de reservas, tope y puente al agente de Telegram (mock).
import { describe, expect, it } from 'vitest';
import { solicitarPiezas, type DepsOmar } from '@/aplicacion/omar/casos';
import { crearAgenteEnMemoria, MIEMBROS_SIMULADOS } from '@/composicion/agente';
import { colaViaAgente } from '@/infra/omar/via_agente';
import { OmarMemoria } from '@/infra/omar/memoria';
import { DISPONIBLE } from './fixtures';

const omar = { rol: 'omar', socio_nombre: null, activo: true } as const;
const K1 = 'web:aaaaaaaa-1111-4222-8333-444455556666';
const K2 = 'web:bbbbbbbb-1111-4222-8333-444455556666';
const pieza = { modelo: 'Elux Legend 3.5K', sabor: 'Sandía' };

function armar(extra: ConstructorParameters<typeof OmarMemoria>[0] = {}) {
  const avisos: string[] = [];
  const mem = new OmarMemoria({ disponible: structuredClone(DISPONIBLE), ...extra }, () => new Date('2026-11-11T18:00:00Z'), async (s) => { avisos.push(s.folio); });
  const d: DepsOmar = { perfil: omar, lector: mem, cola: mem };
  return { mem, d, avisos };
}

describe('cola en memoria', () => {
  it('crea la solicitud pendiente con caducidad de 72 h y avisa al grupo una sola vez', async () => {
    const { d, avisos, mem } = armar();
    const r = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    expect(r).toMatchObject({ ok: true, estado: 'pendiente', repetido: false, caduca_at: '2026-11-14T18:00:00.000Z' });
    expect(avisos).toHaveLength(1);
    expect(mem.solicitudesCreadas[0]).toMatchObject({ estado: 'pendiente', piezas: 3 });
  });
  it('doble clic o reintento con la misma clave no duplica solicitud ni tarjeta', async () => {
    const { d, avisos, mem } = armar();
    const a = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    const b = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    expect(b).toMatchObject({ ok: true, repetido: true });
    expect(a.ok && b.ok && a.folio === b.folio).toBe(true);
    expect(mem.solicitudesCreadas).toHaveLength(1);
    expect(avisos).toHaveLength(1);
  });
  it('valida la existencia contra las reservas de pedidos confirmados sin revelarlas', async () => {
    const { d, mem } = armar({ reservadoPedidos: { 'elux legend 3.5k|sandía': 10 } });
    const r = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 5 });
    expect(r).toMatchObject({ ok: false, motivo: 'sin_disponible' });
    if (!r.ok) expect(r.mensaje).not.toMatch(/\b10\b|reserv|pedido/i);
    expect(mem.solicitudesCreadas).toHaveLength(0);
    expect(await solicitarPiezas(d, { clave: K2, ...pieza, piezas: 2 })).toMatchObject({ ok: true });
  });
  it('las solicitudes pendientes tambien reservan: la segunda no puede comerse lo de la primera', async () => {
    const { d } = armar();
    expect(await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 10 })).toMatchObject({ ok: true });
    expect(await solicitarPiezas(d, { clave: K2, ...pieza, piezas: 5 })).toMatchObject({ ok: false, motivo: 'sin_disponible' });
  });
  it('tope por toma y clave invalida se rechazan antes de la cola', async () => {
    const { d, mem } = armar();
    expect(await solicitarPiezas(d, { clave: K1, modelo: 'Waka Blast 50K', sabor: 'Mango', piezas: 16 })).toMatchObject({ ok: false, motivo: 'tope' });
    expect(await solicitarPiezas(d, { clave: 'malo', ...pieza, piezas: 1 })).toMatchObject({ ok: false, motivo: 'clave' });
    expect(mem.solicitudesCreadas).toHaveLength(0);
  });
  it('los estados llegan a Omar: autorizada baja su existencia, rechazada y caducada se listan', async () => {
    const { d, mem } = armar();
    const a = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    const b = await solicitarPiezas(d, { clave: K2, modelo: 'Waka Blast 50K', sabor: 'Mango', piezas: 1 });
    if (!a.ok || !b.ok) throw new Error('esperaba solicitudes');
    mem.resolver(a.folio, 'autorizada');
    mem.resolver(b.folio, 'rechazada');
    const s = await mem.solicitudes();
    expect(s.estado === 'ok' && s.datos.map((x) => x.estado).sort()).toEqual(['autorizada', 'rechazada']);
    const disp = await mem.disponible();
    expect(disp.estado === 'ok' && disp.datos.find((p) => p.sabor === 'Sandía')?.piezas).toBe(9);
  });
});

describe('puente al agente de Telegram (mock)', () => {
  function conAgente() {
    const h = crearAgenteEnMemoria();
    const autor = MIEMBROS_SIMULADOS.find((m) => m.persona === 'omar')!;
    const cola = colaViaAgente({ agente: h.agente, autor, ahora: h.reloj.ahora, caducaHoras: 72, resolver: (l) => (l.modelo.toLowerCase().startsWith('elux') ? { modeloId: 'm9', saborId: null } : null) });
    const mem = new OmarMemoria({ disponible: structuredClone(DISPONIBLE) });
    const d: DepsOmar = { perfil: omar, lector: mem, cola };
    return { h, d };
  }
  it('la solicitud web publica la tarjeta Autorizar/Rechazar en el grupo de socios y reserva sin tocar kardex', async () => {
    const { h, d } = conAgente();
    const r = await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    expect(r).toMatchObject({ ok: true, estado: 'pendiente' });
    const g = h.telegram.aChat(h.ids.grupoSocios);
    expect(g).toHaveLength(1);
    expect(g[0]!.texto).toContain('pendiente de autorizacion');
    expect(g[0]!.botones!.flat().map((b) => b.texto)).toEqual(['Autorizar', 'Rechazar']);
    expect(h.negocio.existenciaDe('m9')).toBe(50);
    expect(h.negocio.disponibleDe('m9')).toBe(47);
  });
  it('doble clic: una sola tarjeta y una sola reserva', async () => {
    const { h, d } = conAgente();
    await Promise.all([solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 }), solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 })]);
    await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    expect(h.telegram.aChat(h.ids.grupoSocios)).toHaveLength(1);
    expect(h.negocio.disponibleDe('m9')).toBe(47);
  });
  it('un socio autoriza desde el grupo y baja la existencia', async () => {
    const { h, d } = conAgente();
    await solicitarPiezas(d, { clave: K1, ...pieza, piezas: 3 });
    const tarjeta = h.telegram.aChat(h.ids.grupoSocios)[0]!;
    await h.agente.procesarUpdate({ update_id: 900, callback_query: { id: 'cb1', from: { id: h.ids.angelo, is_bot: false, first_name: 'x' }, message: { message_id: tarjeta.messageId, chat: { id: h.ids.grupoSocios, type: 'group' }, date: 0 }, data: tarjeta.botones![0]![0]!.callbackData } } as never);
    expect(h.negocio.estadoToma('T-0001')).toBe('autorizada');
    expect(h.negocio.existenciaDe('m9')).toBe(47);
  });
  it('una pieza desconocida o sin existencia no llega al grupo', async () => {
    const { h, d } = conAgente();
    const mem = d.lector as OmarMemoria;
    expect(mem).toBeDefined();
    const sin = await solicitarPiezas({ ...d, lector: new OmarMemoria({ disponible: [{ modelo: 'Elux Legend 3.5K', sabor: 'Sandía', piezas: 12 }, { modelo: 'Otro', sabor: 'X', piezas: 5 }] }) }, { clave: K2, modelo: 'Otro', sabor: 'X', piezas: 2 });
    expect(sin).toMatchObject({ ok: false, motivo: 'pieza_desconocida' });
    expect(h.telegram.aChat(h.ids.grupoSocios)).toHaveLength(0);
  });
});
