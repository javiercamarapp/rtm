import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { escenario, pedido, pago, toma, unaAccion, consulta, IDS, todosLosNumeros } from './ayudas';
import { respuesta } from '@/infra/agente/llm_simulado';
import { updateTexto } from '@/infra/agente/updates';

const PROHIBIDOS = /costo|margen|utilidad|proveedor|isaac|karen|socio|cliente/i;

describe('criterio: una toma de Omar queda pendiente hasta que un socio autoriza', () => {
  it('Omar pide 3 Elux sandia: tarjeta en el grupo con Autorizar/Rechazar; a Omar solo "recibido, pendiente"; nada en kardex ni saldo', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    const tarjeta = e.ultimoGrupo();
    expect(tarjeta.texto).toContain('Toma T-0001 pendiente de autorizacion');
    expect(tarjeta.texto).toContain('Total a su precio: $450.00');
    expect(tarjeta.botones!.flat().map((b) => b.texto)).toEqual(['Autorizar', 'Rechazar']);
    expect(e.textosOmar()).toEqual(['Recibido T-0001, pendiente de autorizacion.\n- Elux Legend 3.5K: 3 pz']);
    // Pendiente = reserva activa, sin kardex ni saldo.
    expect(e.negocio.existenciaDe('m9')).toBe(50);
    expect(e.negocio.disponibleDe('m9')).toBe(47);
    expect(e.negocio.saldoOmar()).toBe(0n);
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
  });

  it('pasa el tiempo y sigue pendiente (no se autoriza sola)', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    e.reloj.avanzarHoras(48);
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
    expect(e.negocio.saldoOmar()).toBe(0n);
  });

  it('Omar NO puede pulsar Autorizar: alerta de pantalla, cero cambios, y el boton sigue vigente', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    const tarjeta = e.ultimoGrupo();
    const r = await e.pulsar(IDS.omar, IDS.grupoSocios, tarjeta, 0, 0);
    expect(r).toEqual({ estado: 'boton', resultado: 'no_autorizado' });
    expect(e.telegram.callbacks.at(-1)).toMatchObject({ alerta: true });
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
    expect(e.negocio.saldoOmar()).toBe(0n);
    expect(e.almacen.eventos.some((x) => x.tipo === 'boton_no_autorizado')).toBe(true);
    // Un socio todavia puede autorizar: el intento de Omar no consumio el token.
    const ok = await e.pulsar(IDS.angelo, IDS.grupoSocios, tarjeta, 0, 0);
    expect(ok).toEqual({ estado: 'boton', resultado: 'autorizar_toma' });
  });

  it('un socio autoriza: existencia baja, saldo de Omar sube, la tarjeta se edita sin teclado y Omar recibe "autorizado" con su saldo', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    const tarjeta = e.ultimoGrupo();
    await e.pulsar(IDS.javier, IDS.grupoSocios, tarjeta, 0, 0);
    expect(e.negocio.estadoToma('T-0001')).toBe('autorizada');
    expect(e.negocio.existenciaDe('m9')).toBe(47);
    expect(e.negocio.saldoOmar()).toBe(45_000n);
    const edicion = e.telegram.ediciones.at(-1)!;
    expect(edicion.texto).toBe('Toma T-0001 autorizada por Javier.');
    expect(edicion.botones).toBeUndefined();
    expect(e.textosOmar().at(-1)).toBe('Autorizado T-0001. Saldo semanal: $450.00.');
  });

  it('Autorizar y Rechazar se invalidan entre si; basta uno', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    const tarjeta = e.ultimoGrupo();
    await e.pulsar(IDS.angelo, IDS.grupoSocios, tarjeta, 0, 1); // Rechazar
    const r = await e.pulsar(IDS.javier, IDS.grupoSocios, tarjeta, 0, 0); // Autorizar
    expect(r).toEqual({ estado: 'boton', resultado: 'usado' });
    expect(e.negocio.estadoToma('T-0001')).toBe('rechazada');
    expect(e.negocio.disponibleDe('m9')).toBe(50); // reserva liberada
    expect(e.negocio.saldoOmar()).toBe(0n);
    expect(e.textosOmar().at(-1)).toBe('Rechazado T-0001.');
  });

  it('a las 72 horas el boton caduca y la toma caduca: libera la reserva y avisa al grupo y a Omar', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    await e.omar('3 elux sandia');
    const tarjeta = e.ultimoGrupo();
    e.reloj.avanzarHoras(73);
    expect(await e.pulsar(IDS.angelo, IDS.grupoSocios, tarjeta, 0, 0)).toEqual({ estado: 'boton', resultado: 'caducado' });
    expect(await e.agente.caducarTomasVencidas()).toEqual(['T-0001']);
    expect(e.negocio.estadoToma('T-0001')).toBe('caducada');
    expect(e.negocio.disponibleDe('m9')).toBe(50);
    expect(e.textosGrupo().at(-1)).toContain('caduco sin autorizacion');
    expect(e.textosOmar().at(-1)).toBe('Caduco T-0001 sin autorizacion.');
    expect(await e.agente.caducarTomasVencidas()).toEqual([]);
  });

  it('una toma que un socio escribe tambien queda pendiente', async () => {
    const e = escenario([unaAccion(toma([['elux', 2, 'mango']]))]);
    await e.socio('angelo', 'toma 2 elux mango');
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
    expect(e.ultimoGrupo().botones).toBeDefined();
  });

  it('toma sin existencia suficiente: se rechaza y no reserva', async () => {
    const e = escenario([unaAccion(toma([['elux', 60, 'mango']]))]);
    await e.omar('60 elux mango');
    expect(e.negocio.estadoToma('T-0001')).toBeNull();
    expect(e.textosOmar().at(-1)).toBe('No hay existencia suficiente para esa toma.');
  });

  it('el mismo mensaje de Omar dos veces no crea dos tomas', async () => {
    const e = escenario([unaAccion(toma([['elux', 3, 'sandia']]))]);
    const u = updateTexto(e.contador, { de: IDS.omar, chat: IDS.privadoOmar, texto: '3 elux sandia' });
    await e.agente.procesarUpdate(u);
    expect(await e.agente.procesarUpdate(u)).toEqual({ estado: 'duplicado', motivo: 'update' });
    expect(e.negocio.estadoToma('T-0001')).toBe('pendiente');
    expect(e.negocio.estadoToma('T-0002')).toBeNull();
    expect(e.llmGuionado.llamadas).toBe(1);
  });
});

describe('Omar: alcance y privacidad', () => {
  it('Omar no registra pedidos ni pagos: no se ejecuta nada, se le dice y se avisa al grupo', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]])), unaAccion(pago('Cliente Norte', 100_000))]);
    await e.omar('Cliente Norte 28 jupiter');
    await e.omar('pago Cliente Norte 1,000');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.textosOmar()).toEqual(['Eso lo registran los duenos, ya les avise.', 'Eso lo registran los duenos, ya les avise.']);
    expect(e.textosGrupo().filter((t) => t.includes('Omar escribio algo que solo registran los socios'))).toHaveLength(2);
  });

  it('Omar consulta el inventario (solo piezas) y su saldo semanal', async () => {
    const e = escenario([unaAccion(consulta('inventario', { modelo_texto: 'elux' })), unaAccion(consulta('saldo', { sujeto_texto: 'omar' }))]);
    await e.omar('cuanto hay de elux');
    expect(e.textosOmar().at(-1)).toBe('Existencia\n- Elux Legend 3.5K: 50 pz');
    await e.omar('mi saldo 1');
    expect(e.textosOmar().at(-1)).toBe('Saldo de la semana\n- Saldo semanal: $0.00');
  });

  it('Omar no ve utilidad, resumen, precios ni saldos de otros', async () => {
    const e = escenario([
      unaAccion(consulta('resumen', { periodo: 'hoy' })),
      unaAccion(consulta('saldo', { sujeto_texto: 'Cliente Norte' })),
      unaAccion(consulta('saldo', { sujeto_texto: 'socios' })),
      unaAccion(consulta('precio', { sujeto_texto: 'Cliente Norte', modelo_texto: 'jupiter' })),
    ]);
    for (const t of ['resumen 1', 'saldo de Cliente Norte 1', 'saldo socios 1', 'precio jupiter 1']) await e.omar(t);
    expect(e.textosOmar()).toEqual(Array(4).fill('Eso lo registran los duenos, ya les avise.'));
  });

  it('Omar no puede usar /sinia ni /deshacer', async () => {
    const e = escenario();
    expect((await e.omar('/sinia')).estado).toBe('ignorado');
    await e.omar('/deshacer');
    await e.omar('/pago Cliente Norte | 1000');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(await e.almacen.modoSinIa()).toMatchObject({ activo: false });
  });

  it('un mensaje a Omar con terminos prohibidos se bloquea aunque lo arme una plantilla con datos del servidor', async () => {
    const e = escenario([unaAccion(consulta('inventario', {}))]);
    // El servidor devolvio un titulo con una palabra prohibida: la guardia del chat de Omar lo bloquea.
    e.negocio.consultar = async () => ({ titulo: 'Costo y margen por modelo', lineas: [] });
    await e.omar('cuanto hay de todo 1');
    expect(e.textosOmar()).toEqual(['Eso lo registran los duenos, ya les avise.']);
    expect(e.almacen.eventos.some((x) => x.tipo === 'respuesta_bloqueada' && x.detalle === 'fuga_omar')).toBe(true);
  });

  it('propiedad: 50+ corridas sinteticas, ningun mensaje al chat de Omar contiene terminos prohibidos ni cifras ajenas', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 40 }), fc.constantFrom('sandia', 'mango'), fc.boolean(), async (piezas, sabor, autorizar) => {
        const e = escenario([unaAccion(toma([['elux', piezas, sabor]]))]);
        const origen = `${piezas} elux ${sabor}`;
        await e.omar(origen);
        const tarjeta = e.grupo().find((m) => m.botones);
        if (tarjeta) await e.pulsar(IDS.angelo, IDS.grupoSocios, tarjeta, 0, autorizar ? 0 : 1);
        await e.agente.caducarTomasVencidas();
        for (const t of e.textosOmar()) {
          expect(t).not.toMatch(PROHIBIDOS);
          const sinConocidos = t.replace('Elux Legend 3.5K', '').replace(/T-0001/g, '');
          for (const n of todosLosNumeros(sinConocidos)) {
            expect(n === String(piezas) || /^\$?[\d,]+\.\d{2}$/.test(n)).toBe(true);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

describe('identidad y chats', () => {
  it('un usuario que no es miembro se ignora en silencio (sin IA, sin respuesta)', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    const r = await e.agente.procesarUpdate({ update_id: 900, message: { message_id: 1, from: { id: IDS.extrano }, chat: { id: IDS.grupoSocios, type: 'supergroup' }, date: 1, text: 'Cliente Norte 28 jupiter' } });
    expect(r).toEqual({ estado: 'ignorado', motivo: 'no_autorizado' });
    expect(e.llmGuionado.llamadas).toBe(0);
    expect(e.telegram.enviados).toHaveLength(0);
  });

  it('el bot abandona un grupo ajeno al que lo agrego alguien que no es socio (un socio NO lo hace salir)', async () => {
    const e = escenario();
    await e.agente.procesarUpdate({ update_id: 901, message: { message_id: 1, from: { id: IDS.extrano }, chat: { id: -999, type: 'group' }, date: 1, text: 'hola 1' } });
    expect(e.telegram.salidas).toEqual([-999]);
    expect(e.telegram.enviados).toHaveLength(0);
  });

  it('la identidad es el id de Telegram: Omar escribiendo en el grupo se ignora; un socio puede escribir en su chat privado', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000))]);
    const omarEnGrupo = await e.agente.procesarUpdate({ update_id: 902, message: { message_id: 1, from: { id: IDS.omar }, chat: { id: IDS.grupoSocios, type: 'supergroup' }, date: 1, text: 'pago Cliente Norte 1,000' } });
    expect(omarEnGrupo).toEqual({ estado: 'ignorado', motivo: 'no_autorizado' });
    await e.agente.procesarUpdate({ update_id: 903, message: { message_id: 2, from: { id: IDS.javier }, chat: { id: IDS.javier, type: 'private' }, date: 1, text: 'pago Cliente Norte 1,000' } });
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.ultimoGrupo().texto).toContain('Registrado PG-0001 por Javier'); // la respuesta va SIEMPRE al grupo de socios
  });

  it('un chat privado ajeno de un socio desconocido o de Omar en otro chat se ignora', async () => {
    const e = escenario();
    const r = await e.agente.procesarUpdate({ update_id: 904, message: { message_id: 3, from: { id: IDS.omar }, chat: { id: 7777, type: 'private' }, date: 1, text: 'hola 1' } });
    expect(r.estado).toBe('ignorado');
    const sinRemitente = await e.agente.procesarUpdate({ update_id: 905, message: { message_id: 4, chat: { id: 7777, type: 'private' }, date: 1, text: 'hola 1' } });
    expect(sinRemitente).toEqual({ estado: 'ignorado', motivo: 'sin_remitente' });
    expect(await e.agente.procesarUpdate({ update_id: 906 })).toEqual({ estado: 'ignorado', motivo: 'sin_remitente' });
  });

  it('un boton pulsado por alguien que no es miembro, o sin datos, responde con alerta y no hace nada', async () => {
    const e = escenario();
    const r = await e.agente.procesarUpdate({ update_id: 910, callback_query: { id: 'x', from: { id: IDS.extrano }, message: { message_id: 1, chat: { id: IDS.grupoSocios, type: 'supergroup' } }, data: 'b123' } });
    expect(r).toEqual({ estado: 'boton', resultado: 'no_autorizado' });
    const inv = await e.agente.procesarUpdate({ update_id: 911, callback_query: { id: 'y', from: { id: IDS.angelo }, message: { message_id: 1, chat: { id: IDS.grupoSocios, type: 'supergroup' } }, data: 'no-existe' } });
    expect(inv).toEqual({ estado: 'boton', resultado: 'invalido' });
    expect(e.telegram.callbacks.every((c) => c.alerta)).toBe(true);
  });

  it('una tarjeta reenviada a otro chat no sirve (el token es del chat registrado)', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]]))]);
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    const eco = e.ultimoGrupo();
    const r = await e.pulsar(IDS.angelo, 4242, eco, 0);
    expect(r).toEqual({ estado: 'boton', resultado: 'chat_distinto' });
    expect(e.negocio.existenciaDe('m3')).toBe(72);
  });

  it('respuesta(): helper de esquema', () => {
    expect(respuesta([{ tipo: 'ninguna' }]).acciones).toHaveLength(1);
  });
});
