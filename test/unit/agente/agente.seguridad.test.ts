// Revision de seguridad del carril telegram: mensajes reenviados, reclamo antes del limite de frecuencia, quien confirma, hash del efecto,
// firma con boton propio, capital solo declarado y precios ambiguos.
import { describe, expect, it } from 'vitest';
import { escenario, IDS, pedido, unaAccion, consulta } from './ayudas';
import { SEGUNDO_SOCIO_OBLIGATORIO } from '@/aplicacion/agente/agente';
import type { ContextoEjecucion, NegocioAgente } from '@/aplicacion/agente/puertos';
import { declaraCapitalExpreso } from '@/dominio/agente/entrada';
import { parsearPrecio } from '@/dominio/agente/cifras';
import type { Intencion } from '@/dominio/agente/intenciones';
import { NegocioSimulado } from '@/infra/agente/negocio_simulado';
import { preparar } from '@/infra/agente/postgres';

const ESTRICTO = { config: { confirmarMovimientos: true } };
const NINGUNA = [{ acciones: [{ tipo: 'ninguna' as const }], sospecha_inyeccion: false, baja_certeza: false }];
const gasto = (monto: number, por: 'angelo' | 'javier'): Intencion => ({ tipo: 'gasto', gasto: 'guia', monto_centavos: monto, pagado_por: por, descripcion: null, fuente_cita: 'c' });

describe('MEDIO-3: mensajes reenviados', () => {
  it('un /comando en un mensaje reenviado se ignora (no se ejecuta ni se interpreta)', async () => {
    const e = escenario(NINGUNA, ESTRICTO);
    const r = await e.socio('angelo', '/gasto guia 500 angelo', { reenviado: true });
    expect(r).toEqual({ estado: 'ignorado', motivo: 'reenviado_comando' });
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('no se ejecutan desde mensajes reenviados');
    expect(e.llmGuionado.peticiones).toHaveLength(0);
  });

  it('una escritura dictada en un reenviado se rechaza aunque el extractor la entienda; nada se registra ni se pide confirmar', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'angelo'))], ESTRICTO);
    await e.socio('angelo', 'pague 500 de guia', { reenviado: true });
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('no registro movimientos desde mensajes reenviados');
    expect(e.ultimoGrupo().botones ?? []).toHaveLength(0);
  });

  it('las consultas desde un reenviado SI se responden', async () => {
    const e = escenario([unaAccion(consulta('inventario', { modelo_texto: 'jupiter' }))]);
    await e.socio('angelo', 'cuanto hay de jupiter 1', { reenviado: true });
    expect(e.ultimoGrupo().texto).toContain('Waka Jupiter 50K');
  });
});

describe('MEDIO-4: reclamar el mensaje antes del limite de frecuencia', () => {
  it('un mensaje rechazado por frecuencia queda reclamado: su edicion posterior no se procesa como nuevo', async () => {
    const e = escenario(NINGUNA, ESTRICTO);
    e.almacen.mensajesRecientes = async () => 99;
    expect(await e.socio('angelo', '/gasto guia 500 angelo', { messageId: 700 })).toEqual({ estado: 'ignorado', motivo: 'limite_frecuencia' });
    e.almacen.mensajesRecientes = async () => 0;
    const r = await e.socio('angelo', '/gasto guia 500 angelo', { messageId: 700, edicion: true });
    expect(r).toEqual({ estado: 'duplicado', motivo: 'mensaje' });
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.textosGrupo().filter((t) => t.includes('Resumen para confirmar'))).toHaveLength(0);
  });

  it('el mensaje actual cuenta en la ventana: con N permitidos, el N+1 se rechaza', async () => {
    const e = escenario(NINGUNA, ESTRICTO);
    e.almacen.mensajesRecientes = async () => 20; // el actual ya esta reclamado: es el 20.o
    expect((await e.socio('angelo', '/cuadra')).estado).not.toBe('ignorado');
    e.almacen.mensajesRecientes = async () => 21;
    expect(await e.socio('angelo', '/cuadra')).toEqual({ estado: 'ignorado', motivo: 'limite_frecuencia' });
  });
});

describe('MEDIO-2: quien confirma y el efecto confirmado', () => {
  it('el autor confirma lo suyo: si pulsa el otro socio no se registra nada y la tarjeta vuelve para quien la pidio', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia');
    const resumen = e.ultimoGrupo();
    await e.pulsar(IDS.angelo, IDS.grupoSocios, resumen, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.textosGrupo().some((t) => t.includes('Lo pidio Javier: lo confirma el'))).toBe(true);
    const nueva = e.ultimoGrupo();
    expect(nueva.texto).toContain('Resumen para confirmar');
    expect(nueva.messageId).not.toBe(resumen.messageId);
    await e.pulsar(IDS.javier, IDS.grupoSocios, nueva, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });

  it('el otro socio si puede cancelar', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 1);
    expect(e.telegram.ediciones.at(-1)!.texto).toBe('Cancelado.');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('segundo socio obligatorio solo donde esta listado (lote historico): el autor no da su propio refuerzo', async () => {
    expect([...SEGUNDO_SOCIO_OBLIGATORIO]).toEqual(['lote_historico']);
    const negocio = new NegocioSimulado();
    const ctxs: ContextoEjecucion[] = [];
    const n = negocio as unknown as NegocioAgente;
    const ejecutar = n.ejecutar.bind(n);
    n.ejecutar = async (a, ctx) => { ctxs.push(ctx); return ejecutar(a, ctx); };
    const e = escenario(NINGUNA, { ...ESTRICTO, negocio });
    await e.socio('angelo', '/lote octubre\n2026-10-03 gasto javier 500 uber');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0); // confirma el autor
    const refuerzo = e.ultimoGrupo();
    expect(refuerzo.texto).toContain('Confirmacion reforzada');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, refuerzo, 0, 0); // el autor no basta
    expect(e.textosGrupo().some((t) => t.includes('lo debe confirmar el otro socio'))).toBe(true);
    expect(ctxs).toHaveLength(0);
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0); // el otro socio si
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]!.autor.persona).toBe('angelo'); // el autor sigue siendo quien lo pidio
  });

  it('el hash del efecto de la vista previa viaja a la ejecucion', async () => {
    const negocio = new NegocioSimulado();
    const ctxs: ContextoEjecucion[] = [];
    const n = negocio as unknown as NegocioAgente;
    const ejecutar = n.ejecutar.bind(n);
    n.ejecutar = async (a, ctx) => { ctxs.push(ctx); return ejecutar(a, ctx); };
    n.simular = async () => ({ tipo: 'simulado', lineas: [], advertencias: [], cuadra: true, rojas: [], efectoHash: 'hash-de-la-vista-previa' });
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], { ...ESTRICTO, negocio });
    await e.socio('javier', 'pague 500 de guia');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(ctxs).toHaveLength(1);
    expect(ctxs[0]!.efectoHash).toBe('hash-de-la-vista-previa');
  });

  it('la firma del acta lleva el token del boton "Si, estoy seguro" que pulso el autor', async () => {
    const negocio = new NegocioSimulado();
    const ctxs: ContextoEjecucion[] = [];
    const n = negocio as unknown as NegocioAgente;
    const ejecutar = n.ejecutar.bind(n);
    n.ejecutar = async (a, ctx) => { ctxs.push(ctx); return ejecutar(a, ctx); };
    const e = escenario(NINGUNA, { ...ESTRICTO, negocio });
    await e.socio('javier', '/firmaracta');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    const refuerzo = e.ultimoGrupo();
    await e.pulsar(IDS.javier, IDS.grupoSocios, refuerzo, 0, 0);
    expect(ctxs.at(-1)!.tokenBoton).toBe(refuerzo.botones![0]![0]!.callbackData);
  });
});

describe('capital solo si el socio lo declara expresamente', () => {
  const pp = (intencion: 'capital' | 'reembolso' | null): Intencion => ({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 3_050_000, pagado_por: 'javier', cliente_texto: null, intencion, fuente_cita: 'meti 30,500 de capital pagando a Karen' });

  it('el modelo marca capital pero el mensaje no lo dice: se muestra y se trata como reembolso', async () => {
    const e = escenario([unaAccion(pp('capital'))], ESTRICTO);
    await e.socio('javier', 'pague 30,500 a Karen');
    expect(e.ultimoGrupo().texto).toContain('ninguna de capital (por omision es reembolso)');
    expect(e.ultimoGrupo().texto).not.toContain('con sus palabras');
  });

  it('si el socio lo declara, el resumen lo dice con su texto citado', async () => {
    const e = escenario([unaAccion(pp('capital'))], ESTRICTO);
    await e.socio('javier', 'meti 30,500 de capital pagando a Karen');
    expect(e.ultimoGrupo().texto).toContain('Declaracion del socio: capital, con sus palabras');
    expect(e.ultimoGrupo().texto).toContain('meti 30,500 de capital pagando a Karen');
  });

  it.each([
    ['meti 20,000 de capital', true], ['voy a invertir 5 mil', true], ['reinvierto mi utilidad', true], ['meti mas lana al negocio', true], ['aporte para inversion', true],
    ['pague 500 a Karen', false], ['puse 20,000 de mi bolsa', false], ['le pague a Isaac con mi tarjeta', false],
  ])('declaraCapitalExpreso(%s) = %s', (t, v) => expect(declaraCapitalExpreso(t)).toBe(v));

  const ctx = (extra: Partial<ContextoEjecucion> = {}): ContextoEjecucion => ({
    autor: { telegramUserId: 6_000_002, persona: 'javier', rol: 'socio' }, claveIdem: 'tg:1:0', origen: { updateId: 1, chatId: 1, messageId: 1 }, ahora: new Date('2026-11-13T12:00:00Z'), confirmado: false, ...extra,
  });
  const res = { clienteId: null, proveedorId: 'karen' as const, lineas: [], modeloId: null };

  it('preparar: reembolso por omision (sin declara_capital); capital declarado pasa declara_capital = true; nunca con cliente ni con la sociedad', () => {
    expect(preparar({ intencion: pp(null), resoluciones: res }, ctx(), '2026-11-13')!.args).not.toHaveProperty('declara_capital');
    expect(preparar({ intencion: pp('reembolso'), resoluciones: res }, ctx(), '2026-11-13')!.args).not.toHaveProperty('declara_capital');
    expect(preparar({ intencion: pp('capital'), resoluciones: res }, ctx(), '2026-11-13')!.args).toMatchObject({ declara_capital: true, pagado_por: 'javier' });
    expect(preparar({ intencion: { ...(pp('capital') as Extract<Intencion, { tipo: 'pago_proveedor' }>), pagado_por: 'sociedad' }, resoluciones: res }, ctx(), '2026-11-13')!.args).not.toHaveProperty('declara_capital');
    expect(preparar({ intencion: pp('capital'), resoluciones: { ...res, clienteId: '3' } }, ctx(), '2026-11-13')!.args).not.toHaveProperty('declara_capital');
  });

  it('preparar manda a la base el remitente verificado, el hash del efecto y el token del boton', () => {
    const a = preparar({ intencion: pp(null), resoluciones: res }, ctx({ efectoHash: 'abc', tokenBoton: 'tok' }), '2026-11-13')!.args;
    expect(a).toMatchObject({ autor: 'javier', telegram_user_id: 6_000_002, efecto_hash: 'abc', token_boton: 'tok' });
    expect(preparar({ intencion: pp(null), resoluciones: res }, ctx(), '2026-11-13')!.args).not.toHaveProperty('efecto_hash');
  });

  // PENDIENTE (lane/cuadrar-cuentas): cuando exista operacion.pago_proveedor_de_socio con p_declara_capital, la prueba pgTAP 031 y la de integracion
  // deben comprobar el efecto contable real (reembolso por omision, capital declarado). Aqui solo se verifica el paso del parametro.
  it.todo('integracion: pago_proveedor_de_socio registra REEMBOLSO por omision y CAPITAL solo con declara_capital (espera lane/cuadrar-cuentas)');
});

describe('MEDIO-5: precios dictados', () => {
  it.each([
    ['250', 25_000], ['$250', 25_000], ['1250.5', 125_050], ['1,250', 125_000], ['$1,250', 125_000], ['1,250.50', 125_050], ['$1,250.50', 125_050], ['1250', 125_000],
    ['250.5', 25_050], ['12,345.67', 1_234_567], ['15 mil', 1_500_000], ['250 pesos', 25_000], ['doscientos cincuenta', 25_000],
  ])('%s -> %i centavos', (t, c) => expect(parsearPrecio(t)).toEqual({ ok: true, centavos: c }));

  it.each(['1.250', '1.250,50', '1,5', '12.345.678', '1,250,5', '250 o 300'])('%s es ambiguo: se pide aclarar, no se adivina', (t) => expect(parsearPrecio(t)).toEqual({ ok: false, motivo: 'ambiguo' }));
  it.each(['', 'barato', '0'])('%s no es un precio', (t) => expect(parsearPrecio(t)).toMatchObject({ ok: false }));

  it('un precio ambiguo en un pedido se pregunta antes de confirmar y no registra nada', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28, null, '1.250']]))], ESTRICTO);
    await e.socio('angelo', 'Cliente Norte 28 jupiter a 1.250');
    expect(e.ultimoGrupo().texto).toContain('Falta un dato antes de registrar');
    expect(e.ultimoGrupo().texto).toContain('sin ambiguedad');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().botones ?? []).toHaveLength(0);
  });

  it('preparar nunca interpreta un precio ambiguo: lanza en vez de escribirlo', () => {
    const i = pedido('Cliente Norte', [['jupiter', 28, '1', '1.250']]);
    const c: ContextoEjecucion = { autor: { telegramUserId: 6_000_001, persona: 'angelo', rol: 'socio' }, claveIdem: 'tg:1:0', origen: { updateId: 1, chatId: 1, messageId: 1 }, ahora: new Date(), confirmado: false };
    expect(() => preparar({ intencion: i, resoluciones: { clienteId: '1', proveedorId: null, lineas: [{ modeloId: '1', saborId: '1' }], modeloId: null } }, c, '2026-11-13')).toThrow(/ambiguo/);
    const ok = pedido('Cliente Norte', [['jupiter', 28, '1', '1,250.50']]);
    expect(preparar({ intencion: ok, resoluciones: { clienteId: '1', proveedorId: null, lineas: [{ modeloId: '1', saborId: '1' }], modeloId: null } }, c, '2026-11-13')!.args).toMatchObject({ lineas: [{ precio_cent: 125_050 }] });
  });
});
