import { describe, it, expect } from 'vitest';
import { escenario, pedido, pago, unaAccion, IDS } from './ayudas';

describe('criterio: el mismo mensaje dos veces se aplica una sola vez', () => {
  it('mismo update_id (reintento de Telegram): una sola ejecucion, una sola llamada a IA y un solo eco', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    const a = await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 77, messageId: 5 });
    const b = await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 77, messageId: 5 });
    expect(a).toEqual({ estado: 'procesado', acciones: 1 });
    expect(b).toEqual({ estado: 'duplicado', motivo: 'update' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.negocio.existenciaDe('m3')).toBe(72);
    expect(e.negocio.saldoCliente('c1')).toBe(700_000n);
    expect(e.llmGuionado.llamadas).toBe(1);
    expect(e.grupo().filter((m) => m.texto.startsWith('Registrado'))).toHaveLength(1);
    expect(e.almacen.eventos.some((x) => x.tipo === 'update_duplicado')).toBe(true);
  });

  it('el reclamo ocurre ANTES de gastar IA: un duplicado no reserva ni llama', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 9, messageId: 1 });
    const antes = e.presupuesto.snapshot();
    await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 9, messageId: 1 });
    expect(e.presupuesto.snapshot()).toEqual(antes);
    expect(e.llmGuionado.llamadas).toBe(1);
  });

  it('el mismo mensaje de Telegram con OTRO update_id tambien se aplica una sola vez', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 1, messageId: 42 });
    const r = await e.socio('angelo', 'Cliente Norte 28 jupiter', { updateId: 2, messageId: 42 });
    expect(r).toEqual({ estado: 'duplicado', motivo: 'mensaje' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.llmGuionado.llamadas).toBe(1);
  });

  it('un mensaje EDITADO ya procesado no se vuelve a ejecutar: avisa que use /deshacer', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter', { messageId: 8 });
    const r = await e.socio('angelo', 'Cliente Norte 30 jupiter', { messageId: 8, edicion: true });
    expect(r).toEqual({ estado: 'duplicado', motivo: 'mensaje' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.textosGrupo().at(-1)).toContain('no se vuelve a ejecutar');
  });

  it('dos pagos identicos en mensajes distintos son dos pagos (la idempotencia es por mensaje, no por contenido)', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 700_000))]);
    await e.socio('angelo', 'pago Cliente Norte 7,000');
    await e.socio('angelo', 'pago Cliente Norte 7,000');
    expect(e.negocio.numeroDeHechos()).toBe(2);
  });

  it('si el servidor ya tenia la clave (reintento interno), devuelve lo mismo y no duplica ni vuelve a avisar', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 700_000))]);
    await e.socio('angelo', 'pago Cliente Norte 7,000', { updateId: 5, messageId: 5 });
    const hechosAntes = e.negocio.numeroDeHechos();
    // Simula que el almacen perdio el reclamo (otra instancia) pero el servidor conserva la clave de idempotencia.
    const resolucion = { intencion: pago('Cliente Norte', 700_000), resoluciones: { clienteId: 'c1', proveedorId: null, lineas: [], modeloId: null } };
    const r = await e.negocio.ejecutar(resolucion, { autor: { telegramUserId: IDS.angelo, persona: 'angelo', rol: 'socio' }, claveIdem: 'tg:5:0', origen: { updateId: 5, chatId: 1, messageId: 5 }, ahora: e.reloj.ahora(), confirmado: false });
    expect(r.tipo).toBe('ejecutado');
    if (r.tipo === 'ejecutado') expect(r.repetido).toBe(true);
    expect(e.negocio.numeroDeHechos()).toBe(hechosAntes);
  });

  it('un callback repetido (mismo update) o un doble toque no aplica dos veces el Deshacer', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    const eco = e.ultimoGrupo();
    const uno = await e.pulsar(IDS.angelo, IDS.grupoSocios, eco, 0);
    const dos = await e.pulsar(IDS.javier, IDS.grupoSocios, eco, 0);
    expect(uno).toEqual({ estado: 'boton', resultado: 'deshacer' });
    expect(dos).toEqual({ estado: 'boton', resultado: 'usado' });
    expect(e.negocio.existenciaDe('m3')).toBe(100);
    expect(e.negocio.saldoCliente('c1')).toBe(0n);
  });
});
