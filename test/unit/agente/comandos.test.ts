import { describe, it, expect } from 'vitest';
import { LISTA_COMANDOS, parsearComando, USO_COMANDOS } from '@/dominio/agente/comandos';

function intencion(texto: string) {
  const r = parsearComando(texto);
  if (!r || !r.ok || r.tipo !== 'intencion') throw new Error(`no es intencion: ${texto}`);
  return r.intencion;
}

describe('comandos (modo sin IA)', () => {
  it('lo que no empieza con / no es comando', () => {
    expect(parsearComando('Villa 28 jupiter')).toBeNull();
    expect(parsearComando('')).toBeNull();
  });
  it('/pedido con lineas en cualquier orden y envio', () => {
    const i = intencion('/pedido Cliente Norte | jupiter 28 | 24 dm | envio 150');
    expect(i).toMatchObject({ tipo: 'pedido', cliente_texto: 'Cliente Norte', envio_cobrado_centavos: 15000 });
    if (i.tipo === 'pedido') {
      expect(i.lineas.map((l) => [l.modelo_texto, l.piezas])).toEqual([['jupiter', 28], ['dm', 24]]);
    }
  });
  it('/pedido con modelo que lleva cifra ("waka 50 28")', () => {
    const i = intencion('/pedido Sur | waka 50 28');
    if (i.tipo === 'pedido') expect(i.lineas[0]).toMatchObject({ modelo_texto: 'waka 50', piezas: 28 });
  });
  it.each([
    '/pedido',
    '/pedido Sur',
    '/pedido Sur | sin cifra',
    '/pedido Sur | jupiter 0',
    '/pedido Sur | jupiter 5 | envio abc',
  ])('formato invalido "%s" devuelve el uso', (t) => {
    const r = parsearComando(t);
    expect(r).toMatchObject({ ok: false, error: 'formato' });
    if (r && !r.ok) expect(r.uso.length).toBeGreaterThan(0);
  });
  it('/pago, /gasto, /aporte con el monto en centavos exactos', () => {
    expect(intencion('/pago Cliente Norte | 7,000.50')).toMatchObject({ tipo: 'pago', monto_centavos: 700_050 });
    expect(intencion('/gasto guia 500 angelo')).toMatchObject({ tipo: 'gasto', gasto: 'guia', monto_centavos: 50_000, pagado_por: 'angelo' });
    expect(intencion('/aporte javier 1000 para la compra')).toMatchObject({ tipo: 'aportacion', socio: 'javier', monto_centavos: 100_000, motivo: 'para la compra' });
    expect(intencion('/aporte angelo 20')).toMatchObject({ tipo: 'aportacion', motivo: null });
  });
  it.each(['/pago Sur', '/pago Sur | 0', '/pago Sur | abc', '/gasto guia', '/gasto xx 5 angelo', '/gasto guia 5 omar', '/aporte omar 5', '/aporte javier'])(
    'formato invalido "%s"',
    (t) => {
      expect(parsearComando(t)).toMatchObject({ ok: false, error: 'formato' });
    },
  );
  it('/compra, /oc, /pagoprov, /toma', () => {
    expect(intencion('/compra karen | nexa 100 | 50 waka icon')).toMatchObject({ tipo: 'compra', proveedor_texto: 'karen' });
    const oc = intencion('/oc Karen | nexa 100 | saldo');
    expect(oc).toMatchObject({ tipo: 'orden_compra', aplicar_saldo: true });
    expect(intencion('/oc Karen | nexa 100')).toMatchObject({ aplicar_saldo: false });
    expect(intencion('/pagoprov isaac | 12000 | javier')).toMatchObject({ tipo: 'pago_proveedor', monto_centavos: 1_200_000, pagado_por: 'javier' });
    expect(intencion('/toma elux 5 | dm 3')).toMatchObject({ tipo: 'toma_omar' });
  });
  it.each(['/compra', '/compra karen', '/compra karen | x', '/oc', '/pagoprov karen | 5', '/pagoprov', '/toma', '/toma x', '/toma elux 201'])('formato invalido "%s"', (t) => {
    expect(parsearComando(t)).toMatchObject({ ok: false, error: 'formato' });
  });
  it('consultas: /stock /saldo /resumen /pendientes /explicar /ayuda /deshacer', () => {
    expect(intencion('/stock jupiter')).toMatchObject({ tipo: 'consulta', consulta: 'inventario', modelo_texto: 'jupiter' });
    expect(intencion('/stock')).toMatchObject({ modelo_texto: null });
    expect(intencion('/saldo karen')).toMatchObject({ consulta: 'saldo_proveedor', sujeto_texto: 'karen' });
    expect(intencion('/saldo omar')).toMatchObject({ consulta: 'saldo' });
    expect(intencion('/resumen')).toMatchObject({ consulta: 'resumen', periodo: 'hoy' });
    expect(intencion('/resumen semana')).toMatchObject({ periodo: 'semana' });
    expect(intencion('/pendientes')).toMatchObject({ consulta: 'pendientes' });
    expect(intencion('/explicar p-0123')).toMatchObject({ consulta: 'explicar', folio: 'P-0123' });
    expect(intencion('/ayuda')).toMatchObject({ consulta: 'ayuda' });
    expect(intencion('/start')).toMatchObject({ consulta: 'ayuda' });
    expect(intencion('/deshacer')).toEqual({ tipo: 'deshacer', folio: null });
    expect(intencion('/deshacer p-0007')).toEqual({ tipo: 'deshacer', folio: 'P-0007' });
    expect(parsearComando('/saldo')).toMatchObject({ ok: false });
    expect(parsearComando('/resumen mañana')).toMatchObject({ ok: false });
    expect(parsearComando('/explicar')).toMatchObject({ ok: false });
  });
  it('/sinia y /conia son controles; el sufijo @bot se ignora; comandos raros se rechazan con la lista', () => {
    expect(parsearComando('/sinia')).toEqual({ ok: true, tipo: 'control', control: 'sinia' });
    expect(parsearComando('/conia@rtm_bot')).toEqual({ ok: true, tipo: 'control', control: 'conia' });
    expect(parsearComando('/stock@rtm_bot jupiter')).toMatchObject({ ok: true });
    expect(parsearComando('/borrartodo')).toEqual({ ok: false, error: 'comando_desconocido', uso: LISTA_COMANDOS });
  });
  it('la lista de comandos del aviso nombra los de la spec', () => {
    for (const c of ['pedido', 'pago', 'gasto', 'compra', 'stock', 'saldo', 'deshacer', 'resumen', 'pendientes']) {
      expect(LISTA_COMANDOS).toContain(`/${c}`);
      expect(USO_COMANDOS[c]).toBeDefined();
    }
  });
});
