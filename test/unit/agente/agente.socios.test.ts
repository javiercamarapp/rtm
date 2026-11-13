// Lane telegram-agente: lo que los socios registran para cuadrar cuentas. Modo estricto (resumen + confirmacion explicita). Modelo simulado, sin red.
import { describe, it, expect } from 'vitest';
import { escenario, unaAccion, consulta, IDS, todosLosNumeros } from './ayudas';
import { interpretarHeuristico } from '@/infra/agente/llm_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';
import { crearAgenteEnMemoria } from '@/composicion/agente';
import { ejecutarGuion } from '@/composicion/simulador_agente';
import { validarRespuesta } from '@/aplicacion/agente/esquemas';
import { parsearComando } from '@/dominio/agente/comandos';

const ESTRICTO = { config: { confirmarMovimientos: true } };
const reembolso = (socio: 'angelo' | 'javier', monto: number, via: 'transferencia' | 'efectivo' | null = 'transferencia'): Intencion => ({ tipo: 'reembolso_socio', socio, monto_centavos: monto, via, fuente_cita: 'c' });
const retiro = (socio: 'angelo' | 'javier', monto: number): Intencion => ({ tipo: 'retiro_utilidad', socio, monto_centavos: monto, via: 'efectivo', fuente_cita: 'c' });
const aportacion = (socio: 'angelo' | 'javier', monto: number, intencion: 'capital' | 'reembolso' | null): Intencion => ({ tipo: 'aportacion', socio, monto_centavos: monto, motivo: null, intencion, fuente_cita: 'c' });
const gasto = (monto: number, por: 'angelo' | 'javier' | 'sociedad'): Intencion => ({ tipo: 'gasto', gasto: 'guia', monto_centavos: monto, pagado_por: por, descripcion: null, fuente_cita: 'c' });

describe('resumen y confirmacion explicita antes de registrar dinero', () => {
  it('muestra el resumen con botones, no registra nada y registra solo al confirmar', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    const resumen = e.ultimoGrupo();
    expect(resumen.texto).toContain('Todavia no se registro nada');
    expect(resumen.texto).toContain('$500.00');
    expect(resumen.botones?.[0]?.map((b) => b.texto)).toEqual(['Confirmar', 'Cancelar']);
    await e.pulsar(IDS.angelo, IDS.grupoSocios, resumen, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.negocio.deudaCon('javier')).toBe(50_000n);
    expect(e.ultimoGrupo().texto).toContain('Registrado');
    expect(e.ultimoGrupo().texto).toContain('confirmado por Angelo');
  });

  it('confirmacion negada: Cancelar no registra y el boton ya no sirve', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia');
    const resumen = e.ultimoGrupo();
    await e.pulsar(IDS.javier, IDS.grupoSocios, resumen, 0, 1);
    expect(e.negocio.numeroDeHechos()).toBe(0);
    const r = await e.pulsar(IDS.javier, IDS.grupoSocios, resumen, 0, 0);
    expect(r).toMatchObject({ estado: 'boton', resultado: 'usado' });
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('el mismo mensaje (reenvio o edicion) no genera otro resumen ni registra dos veces; el boton sirve una sola vez', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia', { updateId: 900, messageId: 55 });
    const n = e.grupo().length;
    expect(await e.socio('javier', 'pague 500 de guia', { updateId: 901, messageId: 55 })).toMatchObject({ estado: 'duplicado' });
    expect(e.grupo().length).toBe(n);
    const resumen = e.ultimoGrupo();
    await e.pulsar(IDS.javier, IDS.grupoSocios, resumen, 0, 0);
    await e.pulsar(IDS.javier, IDS.grupoSocios, resumen, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });

  it('Omar no puede confirmar ni registrar dinero', async () => {
    const e = escenario([unaAccion(gasto(50_000, 'javier'))], ESTRICTO);
    await e.socio('javier', 'pague 500 de guia');
    const resumen = e.ultimoGrupo();
    const r = await e.pulsar(IDS.omar, IDS.grupoSocios, resumen, 0, 0);
    expect(r).toMatchObject({ resultado: 'no_autorizado' });
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('el resumen no trae ninguna cifra que el socio no haya escrito', async () => {
    const e = escenario([unaAccion(reembolso('angelo', 150_000))], ESTRICTO);
    await e.socio('javier', 'reembolso a Angelo 1,500 por transferencia');
    for (const n of todosLosNumeros(e.ultimoGrupo().texto)) expect(['1,500.00', '24', '1500', '00']).toContain(n);
  });
});

describe('si falta un dato, pregunta (aclarar); nunca supone', () => {
  it('reembolso sin via, pago sin cuenta, gasto de la sociedad sin quien pago', async () => {
    const e = escenario([unaAccion(reembolso('javier', 100_000, null)), unaAccion({ tipo: 'pago', cliente_texto: 'Cliente Norte', monto_centavos: 700_000, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: 'c' }), unaAccion(gasto(30_000, 'sociedad'))], ESTRICTO);
    await e.socio('angelo', 'reembolso a Javier 1000');
    expect(e.ultimoGrupo().texto).toContain('transferencia o en efectivo');
    // El dato faltante se pide con botones (estado de conversacion en tokens con expiracion): nada se registra todavia.
    expect(e.ultimoGrupo().botones).toBeDefined();
    await e.socio('angelo', 'Cliente Norte pago 7000');
    expect(e.ultimoGrupo().texto).toContain('a que cuenta entro');
    await e.socio('angelo', 'gaste 300 de guia');
    expect(e.ultimoGrupo().texto).toContain('quien pago el gasto');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('el modelo propone aclarar: se responde la pregunta y no se registra', async () => {
    const e = escenario([unaAccion({ tipo: 'aclarar', pregunta: 'De cuanto fue el reembolso?' })], ESTRICTO);
    await e.socio('angelo', 'le pague a Javier lo que le debia');
    expect(e.ultimoGrupo().texto).toContain('De cuanto');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
});

describe('la IA nunca calcula dinero', () => {
  it('un monto que el modelo suma o deduce (no esta en el mensaje) se rechaza antes del resumen', async () => {
    const e = escenario([unaAccion(reembolso('javier', 150_000))], ESTRICTO);
    await e.socio('angelo', 'reembolsa a Javier 1000 y luego 500 mas por transferencia');
    // 1000 y 500 estan en el mensaje, 1500 no: el total lo debe dar el servidor, no el modelo
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('no encuentro la cifra');
    expect(e.ultimoGrupo().botones).toBeUndefined();
  });

  it('"lo que le debo" no es una cifra: el monto inventado se bloquea', async () => {
    const e = escenario([unaAccion(reembolso('javier', 123_456))], ESTRICTO);
    await e.socio('angelo', 'pagale a Javier todo lo que le debemos por transferencia');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('no encuentro la cifra');
  });

  it('el esquema estricto rechaza campos de calculo ajenos', () => {
    const r = validarRespuesta({ acciones: [{ tipo: 'reembolso_socio', socio: 'javier', monto_centavos: 100, via: null, total_calculado: 5, fuente_cita: 'c' }], sospecha_inyeccion: false, baja_certeza: false });
    expect(r.ok).toBe(false);
  });
});

describe('reembolso, retiro, aportacion y cuenta entre socios', () => {
  it('reembolso: baja lo pendiente; no puede exceder lo que se le debe', async () => {
    const e = escenario([unaAccion(gasto(80_000, 'javier')), unaAccion(reembolso('javier', 50_000)), unaAccion(reembolso('javier', 90_000))], ESTRICTO);
    for (const t of ['pague 800 de guia', 'reembolso a Javier 500 transferencia']) {
      await e.socio('javier', t);
      await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    }
    expect(e.negocio.deudaCon('javier')).toBe(30_000n);
    expect(e.negocio.reembolsadoA('javier')).toBe(50_000n);
    await e.socio('javier', 'reembolso a Javier 900 transferencia');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.ultimoGrupo().texto).toContain('excede');
    expect(e.negocio.deudaCon('javier')).toBe(30_000n);
  });

  it('retiro de utilidad: solo de la utilidad ya asignada', async () => {
    const e = escenario([unaAccion(retiro('angelo', 400_000)), unaAccion(retiro('angelo', 400_000))], ESTRICTO);
    await e.socio('angelo', 'retiro 4000 de utilidad');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.ultimoGrupo().texto).toContain('excede la utilidad');
    e.negocio.ponerUtilidadAsignada('angelo', 1_000_000n);
    await e.socio('angelo', 'retiro 4000 de utilidad otra vez');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.retiradoPor('angelo')).toBe(400_000n);
  });

  it('aportacion: es capital solo si el socio lo declara; si no, reembolso y el resumen lo dice', async () => {
    const e = escenario([unaAccion(aportacion('javier', 2_000_000, 'capital')), unaAccion(aportacion('javier', 100_000, null))], ESTRICTO);
    await e.socio('javier', 'meti 20,000 de capital para invertir');
    expect(e.ultimoGrupo().texto).toContain('capital que declaro');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.capitalDe('javier')).toBe(2_000_000n);
    expect(e.negocio.deudaCon('javier')).toBe(0n);
    await e.socio('javier', 'puse 1000 para gastos');
    expect(e.ultimoGrupo().texto).toContain('reembolso, cuenta por pagar');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.deudaCon('javier')).toBe(100_000n);
  });

  it('deshacer revierte un reembolso y queda en el libro', async () => {
    const e = escenario([unaAccion(gasto(80_000, 'angelo')), unaAccion(reembolso('angelo', 80_000)), unaAccion({ tipo: 'deshacer', folio: null })], ESTRICTO);
    for (const t of ['pague 800 de guia', 'reembolso a Angelo 800 efectivo']) {
      await e.socio('angelo', t);
      await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    }
    expect(e.negocio.deudaCon('angelo')).toBe(0n);
    await e.socio('angelo', 'deshaz');
    expect(e.negocio.deudaCon('angelo')).toBe(80_000n);
    expect(e.negocio.reembolsadoA('angelo')).toBe(0n);
  });
});

describe('cobro, pago a proveedor, devolucion y paquete', () => {
  it('cobro a cliente con cuenta: resumen, confirmacion y saldo del servidor', async () => {
    const e = escenario([unaAccion({ tipo: 'pago', cliente_texto: 'Cliente Norte', monto_centavos: 700_000, cuenta_destino_texto: 'Efectivo', pedido_folio: null, fuente_cita: 'c' })], ESTRICTO);
    await e.socio('angelo', 'Cliente Norte pago 7000 en efectivo');
    expect(e.ultimoGrupo().texto).toContain('Cliente: Cliente Norte');
    expect(e.ultimoGrupo().texto).toContain('Efectivo');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.saldoCliente('c1')).toBe(-700_000n);
  });

  it('pago a proveedor de un socio con resumen', async () => {
    const e = escenario([unaAccion({ tipo: 'pago_proveedor', proveedor_texto: 'Karen', monto_centavos: 3_050_000, pagado_por: 'javier', cliente_texto: null, fuente_cita: 'c' })], ESTRICTO);
    await e.socio('javier', 'pague 30,500 a Karen');
    expect(e.ultimoGrupo().texto).toContain('Proveedor: Karen');
    await e.pulsar(IDS.javier, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.cuentaCon('karen')).toBe(3_050_000n);
  });

  const dev: Intencion = { tipo: 'devolucion', cliente_texto: 'Cliente Norte', pedido_folio: 'P-0001', lineas: [{ modelo_texto: 'jupiter', sabor_texto: null, piezas: 5 }], destino: 'inventario', motivo: null, fuente_cita: 'c' };
  const paq: Intencion = { tipo: 'paquete_perdido', pedido_folio: 'P-0001', cliente_texto: null, incidente: 'perdido', detalle: null, fuente_cita: 'c' };

  it('devolucion y paquete perdido: sin la rama hermana en la base responden dependencia pendiente y no registran', async () => {
    const e = escenario([unaAccion(dev), unaAccion(paq)], ESTRICTO);
    for (const t of ['Cliente Norte devolvio 5 jupiter del pedido P-0001', 'el paquete P-0001 se perdio']) {
      await e.socio('angelo', t);
      await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
      expect(e.ultimoGrupo().texto).toContain('depende de la rama');
    }
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('con la dependencia encendida (contrato): la devolucion baja el saldo y regresa a inventario; el paquete abre incidente sin mover dinero', async () => {
    const e = escenario([unaAccion(dev), unaAccion(paq)], ESTRICTO);
    e.negocio.dependencias.devolucion = true;
    e.negocio.dependencias.paquete = true;
    const antes = e.negocio.existenciaDe('m3');
    await e.socio('angelo', 'Cliente Norte devolvio 5 jupiter del pedido P-0001');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.saldoCliente('c1')).toBe(-125_000n);
    expect(e.negocio.existenciaDe('m3')).toBe(antes + 5);
    await e.socio('angelo', 'el paquete P-0001 se perdio');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    expect(e.negocio.incidentes).toHaveLength(1);
  });
});

describe('consultas (sin confirmacion)', () => {
  it('estado de cuenta de un socio, utilidad del mes, cartera y existencias', async () => {
    const e = escenario(
      [unaAccion(consulta('estado_cuenta_socio', { sujeto_texto: 'javier' })), unaAccion(consulta('utilidad', { periodo: 'mes' })), unaAccion(consulta('cartera')), unaAccion(consulta('inventario', { modelo_texto: 'jupiter' }))],
      ESTRICTO,
    );
    for (const t of ['estado de cuenta de javier', 'utilidad del mes', 'cuanto debe cada cliente', 'cuanto hay de jupiter']) await e.socio('angelo', t);
    const g = e.textosGrupo().join('\n');
    expect(g).toContain('Estado de cuenta de Javier');
    expect(g).toContain('Utilidad operativa (mes)');
    expect(g).toContain('Ningun cliente debe nada');
    expect(g).toContain('Waka Jupiter 50K');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('Omar no ve estado de socios, utilidad ni cartera', async () => {
    const e = escenario([unaAccion(consulta('utilidad', { periodo: 'mes' }))], ESTRICTO);
    await e.omar('utilidad del mes');
    expect(e.textosOmar().join(' ')).not.toMatch(/utilidad operativa/i);
  });
});

describe('comandos de los socios (modo sin IA)', () => {
  const c = (t: string) => {
    const r = parsearComando(t);
    return r && r.ok && r.tipo === 'intencion' ? r.intencion : null;
  };
  it('reembolso, retiro, aporte capital, devolucion, paquete y consultas', () => {
    expect(c('/reembolso javier 1000 efectivo')).toMatchObject({ tipo: 'reembolso_socio', socio: 'javier', monto_centavos: 100_000, via: 'efectivo' });
    expect(c('/retiro angelo 5000 transferencia')).toMatchObject({ tipo: 'retiro_utilidad', monto_centavos: 500_000 });
    expect(c('/aporte javier 20000 capital')).toMatchObject({ tipo: 'aportacion', intencion: 'capital', motivo: null });
    expect(c('/aporte javier 500 gastos varios')).toMatchObject({ intencion: null, motivo: 'gastos varios' });
    expect(c('/devolucion Cliente Norte | P-0001 | jupiter 5 | merma | llego roto')).toMatchObject({ tipo: 'devolucion', pedido_folio: 'P-0001', destino: 'merma', motivo: 'llego roto' });
    expect(c('/paquete danado P-0003')).toMatchObject({ tipo: 'paquete_perdido', incidente: 'danado' });
    expect(c('/estado angelo')).toMatchObject({ consulta: 'estado_cuenta_socio', sujeto_texto: 'angelo' });
    expect(c('/utilidad semana')).toMatchObject({ consulta: 'utilidad', periodo: 'semana' });
    expect(c('/cartera')).toMatchObject({ consulta: 'cartera' });
    expect(c('/reembolso javier 1000 cheque')).toBeNull();
  });
});

describe('simulador completo con el modelo heuristico y la configuracion de produccion', () => {
  it('frases de WhatsApp: confirmar registra, sin confirmar no', async () => {
    const h = crearAgenteEnMemoria();
    const t = await ejecutarGuion(
      ['javier> pague 500 de guia', 'angelo> utilidad del mes', 'javier> meti 20,000 de capital para invertir', 'boton angelo 2', 'javier> deshaz'],
      h,
    );
    const texto = t.join('\n');
    expect(texto).toContain('Resumen para confirmar');
    expect(texto).toContain('Utilidad operativa (mes)');
    expect(h.negocio.numeroDeHechos()).toBe(0);
  });
});

describe('evals deterministas del modelo simulado (frases de WhatsApp de los socios)', () => {
  const casos: Array<['angelo' | 'javier', string, Record<string, unknown>]> = [
    ['javier', 'le pague a Angelo 1,000 de reembolso por transferencia', { tipo: 'reembolso_socio', socio: 'angelo', monto_centavos: 100_000, via: 'transferencia' }],
    ['angelo', 'reembolso a Javier 2500 en efectivo', { tipo: 'reembolso_socio', socio: 'javier', monto_centavos: 250_000, via: 'efectivo' }],
    ['angelo', 'retiro 4,000 de utilidad en efectivo', { tipo: 'retiro_utilidad', socio: 'angelo', monto_centavos: 400_000, via: 'efectivo' }],
    ['javier', 'puse 20 mil de capital para invertir', { tipo: 'aportacion', socio: 'javier', monto_centavos: 2_000_000, intencion: 'capital' }],
    ['javier', 'puse 1000 para gastos', { tipo: 'aportacion', intencion: null }],
    ['angelo', 'Cliente Norte pago 7,000 en efectivo', { tipo: 'pago', cuenta_destino_texto: 'efectivo', monto_centavos: 700_000 }],
    ['angelo', 'Cliente Norte devolvio 5 jupiter del pedido P-0001 a inventario', { tipo: 'devolucion', pedido_folio: 'P-0001', destino: 'inventario' }],
    ['angelo', 'el paquete del pedido P-0003 se perdio', { tipo: 'paquete_perdido', pedido_folio: 'P-0003', incidente: 'perdido' }],
    ['javier', 'estado de cuenta de Angelo', { tipo: 'consulta', consulta: 'estado_cuenta_socio', sujeto_texto: 'angelo' }],
    ['javier', 'utilidad de la semana', { tipo: 'consulta', consulta: 'utilidad', periodo: 'semana' }],
    ['javier', 'cuanto debe cada cliente', { tipo: 'consulta', consulta: 'cartera' }],
  ];
  it.each(casos)('%s: "%s"', (autor, texto, esperado) => {
    const r = interpretarHeuristico(autor, texto);
    expect(r.acciones[0]).toMatchObject(esperado);
  });
});
