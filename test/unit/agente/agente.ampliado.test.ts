// Lane telegram-agente (segunda entrega): catalogo declarativo, esquemas, comandos nuevos, confirmacion reforzada, faltantes con botones, firma personal y limite de frecuencia.
import { describe, expect, it } from 'vitest';
import { escenario, IDS } from './ayudas';
import { CATALOGO_INTENCIONES, CONSULTAS_EXT } from '@/dominio/agente/catalogo_intenciones';
import { INTENCIONES_ESCRITURA, TIPOS_CONSULTA, exigeConfirmacion, type TipoIntencion } from '@/dominio/agente/intenciones';
import { EsquemaIntencion, validarRespuesta } from '@/aplicacion/agente/esquemas';
import { parsearComando, parsearRenglonHistorico } from '@/dominio/agente/comandos';
import { interpretarHeuristico } from '@/infra/agente/llm_simulado';

const ESTRICTO = { config: { confirmarMovimientos: true } };

describe('catalogo declarativo de intenciones', () => {
  const tiposZod = EsquemaIntencion.options.map((o) => o.shape.tipo.value as TipoIntencion);

  it('toda intencion del esquema zod tiene fila en la tabla y viceversa', () => {
    expect([...tiposZod].sort()).toEqual(Object.keys(CATALOGO_INTENCIONES).sort());
  });

  it('las escrituras apuntan a una puerta del esquema agente con un tipo fijo (nunca SQL generado)', () => {
    for (const t of INTENCIONES_ESCRITURA) {
      const d = CATALOGO_INTENCIONES[t];
      if (t === 'deshacer') continue;
      expect(['agente.ejecutar', 'agente.ejecutar_ext'], t).toContain(d.hub);
      expect(d.tipoHub, t).toMatch(/^[a-z_]+$/);
      expect(d.funcionesSql.length, t).toBeGreaterThan(0);
      expect(d.funcionesSql.every((f) => /^[a-z_]+\.[a-z_]+$/.test(f)), t).toBe(true);
    }
  });

  it('solo los socios escriben; Omar solo toma y consulta', () => {
    for (const t of INTENCIONES_ESCRITURA) {
      if (t === 'toma_omar') continue;
      expect(CATALOGO_INTENCIONES[t].quien, t).toBe('socios');
    }
  });

  it('lo que no se deshace por Telegram exige confirmacion reforzada o lo dice', () => {
    for (const t of ['pedido_cancelar', 'conteo', 'lote_historico'] as const) {
      expect(CATALOGO_INTENCIONES[t].confirmacion, t).toBe('reforzada');
    }
    // Decision del dueno (14-nov): sin tarjeta ni boton generico; la firma del acta es el mensaje personal de cada socio (queda registrado en SQL).
    for (const t of ['acta_propuesta', 'acta_firma'] as const) expect(CATALOGO_INTENCIONES[t].confirmacion, t).toBe('ninguna');
    expect(CATALOGO_INTENCIONES.devolucion.estado).toBe('contrato');
    expect(CATALOGO_INTENCIONES.paquete_perdido.estado).toBe('contrato');
    expect(exigeConfirmacion('merma')).toBe(true);
  });

  it('las consultas nuevas viven en consulta_ext', () => {
    for (const c of ['cuadra', 'balance', 'diario', 'cobertura', 'reporte', 'compras', 'pedidos', 'saldos_socios', 'pendientes']) {
      expect(TIPOS_CONSULTA).toContain(c);
      expect(CONSULTAS_EXT.has(c)).toBe(true);
    }
  });
});

describe('esquemas estrictos de las intenciones nuevas', () => {
  it('rechazan propiedades desconocidas y rangos invalidos', () => {
    expect(validarRespuesta({ acciones: [{ tipo: 'merma', modelo_texto: 'a', sabor_texto: null, piezas: 3, motivo: 'm', fuente_cita: 'c', extra: 1 }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
    expect(validarRespuesta({ acciones: [{ tipo: 'merma', modelo_texto: 'a', sabor_texto: null, piezas: 0, motivo: 'm', fuente_cita: 'c' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
    expect(validarRespuesta({ acciones: [{ tipo: 'sql', consulta: 'drop table x' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
  });

  it('aceptan un lote historico con fechas explicitas y rechazan fechas mal formadas', () => {
    const renglon = { tipo: 'gasto', fecha: '2026-10-03', monto_centavos: 50_000, socio: 'javier', cliente_texto: null, cuenta_texto: null, concepto: 'uber', intencion: null, via: null };
    expect(validarRespuesta({ acciones: [{ tipo: 'lote_historico', etiqueta: 'oct', total_dictado_centavos: null, renglones: [renglon], fuente_cita: 'c' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(true);
    expect(validarRespuesta({ acciones: [{ tipo: 'lote_historico', etiqueta: 'oct', total_dictado_centavos: null, renglones: [{ ...renglon, fecha: 'octubre' }], fuente_cita: 'c' }], sospecha_inyeccion: false, baja_certeza: false }).ok).toBe(false);
  });
});

describe('comandos nuevos (sin IA)', () => {
  it('parsea pedido en estado, compras, mermas, servicios, acta y consultas', () => {
    expect(parsearComando('/enviado p-1 GUIA9')).toMatchObject({ ok: true, intencion: { tipo: 'pedido_envio', pedido_folio: 'P-1', estado: 'enviado', guia_texto: 'GUIA9' } });
    expect(parsearComando('/cancelar P-0001 | cliente se arrepintio')).toMatchObject({ intencion: { tipo: 'pedido_cancelar', motivo: 'cliente se arrepintio' } });
    expect(parsearComando('/recibir C-0002')).toMatchObject({ intencion: { tipo: 'compra_recepcion', lineas: [] } });
    expect(parsearComando('/recibir C-0002 | jupiter/uva 30')).toMatchObject({ intencion: { tipo: 'compra_recepcion', lineas: [{ modelo_texto: 'jupiter', sabor_texto: 'uva', piezas: 30 }] } });
    expect(parsearComando('/merma jupiter/uva 2 | caja danada')).toMatchObject({ intencion: { tipo: 'merma', piezas: 2, motivo: 'caja danada' } });
    expect(parsearComando('/servicio openrouter 20usd javier tc 18.5')).toMatchObject({ intencion: { tipo: 'gasto_servicio', monto_usd_centavos: 2000, tipo_cambio_micro: 18_500_000, pagado_por: 'javier' } });
    expect(parsearComando('/servicio vercel 500 angelo')).toMatchObject({ intencion: { tipo: 'gasto_servicio', monto_mxn_centavos: 50_000, monto_usd_centavos: null } });
    expect(parsearComando('/acta 2026-10 retira angelo 1000 reinvierte javier 500')).toMatchObject({ intencion: { tipo: 'acta_propuesta', mes: '2026-10', retira_angelo_centavos: 100_000, reinvierte_javier_centavos: 50_000 } });
    expect(parsearComando('/cuadra')).toMatchObject({ intencion: { tipo: 'consulta', consulta: 'cuadra' } });
    expect(parsearComando('/socios')).toMatchObject({ intencion: { tipo: 'consulta', consulta: 'saldos_socios' } });
    expect(parsearComando('/merma jupiter')).toMatchObject({ ok: false });
  });

  it('parsea un lote historico renglon por renglon y rechaza lo que no entiende', () => {
    const r = parsearComando('/lote octubre\n2026-10-03 gasto javier 500 uber\n2026-10-04 cobro Cliente Norte 7000 efectivo\n2026-10-05 aportacion angelo 1000 capital');
    expect(r).toMatchObject({ ok: true, intencion: { tipo: 'lote_historico', etiqueta: 'octubre' } });
    if (r?.ok && r.tipo === 'intencion' && r.intencion.tipo === 'lote_historico') {
      expect(r.intencion.renglones.map((x) => x.tipo)).toEqual(['gasto', 'cobro', 'aportacion']);
      expect(r.intencion.renglones[1]).toMatchObject({ cliente_texto: 'Cliente Norte', cuenta_texto: 'efectivo', monto_centavos: 700_000 });
    }
    expect(parsearComando('/lote x\n2026-10-03 regalo javier 500')).toMatchObject({ ok: false });
    expect(parsearRenglonHistorico('mañana gasto javier 500')).toBeNull();
  });

  it('una suma dictada que no cuadra con los renglones bloquea el lote y pide correccion', async () => {
    const e = escenario([{ acciones: [{ tipo: 'ninguna' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    await e.socio('javier', '/lote octubre\ntotal 1000\n2026-10-03 gasto javier 500 uber\n2026-10-04 gasto javier 400 guia');
    expect(e.ultimoGrupo().texto).toContain('La suma de los renglones es $900.00 y dijiste $1,000.00');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    await e.socio('javier', '/lote octubre\ntotal 900\n2026-10-03 gasto javier 500 uber\n2026-10-04 gasto javier 400 guia');
    expect(e.ultimoGrupo().texto).toContain('Lote: octubre');
    expect(e.ultimoGrupo().texto).toContain('Todavia no se registro nada');
  });

  it('el extractor simulado entiende frases nuevas', () => {
    expect(interpretarHeuristico('javier', 'se envio el pedido P-0003').acciones[0]).toMatchObject({ tipo: 'pedido_envio', estado: 'enviado', pedido_folio: 'P-0003' });
    expect(interpretarHeuristico('angelo', 'que falta por hacer').acciones[0]).toMatchObject({ tipo: 'consulta', consulta: 'pendientes' });
    expect(interpretarHeuristico('angelo', 'pague 20 usd de openrouter').acciones[0]).toMatchObject({ tipo: 'gasto_servicio', monto_usd_centavos: 2000 });
  });
});

describe('flujos del agente: confirmacion reforzada, faltantes, firma personal, frecuencia', () => {
  it('una accion que no se deshace pide un segundo si y dice que no hay deshacer; nada se escribe antes', async () => {
    const e = escenario([{ acciones: [{ tipo: 'ninguna' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    await e.socio('angelo', '/cancelar P-0001 | error de captura');
    const resumen = e.ultimoGrupo();
    expect(resumen.texto).toContain('Todavia no se registro nada');
    expect(resumen.texto).toContain('NO se puede deshacer por Telegram');
    expect(resumen.texto).toContain('segunda confirmacion');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, resumen, 0, 0);
    const refuerzo = e.ultimoGrupo();
    expect(refuerzo.texto).toContain('Confirmacion reforzada');
    expect(refuerzo.botones?.[0]?.[0]?.texto).toBe('Si, estoy seguro');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('el dato faltante se pide con botones y al elegir sigue el resumen', async () => {
    const e = escenario([{ acciones: [{ tipo: 'pago', cliente_texto: 'Cliente Norte', monto_centavos: 700_000, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: 'c' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    await e.socio('angelo', 'Cliente Norte pago 7000');
    const pregunta = e.ultimoGrupo();
    expect(pregunta.texto).toContain('a que cuenta entro');
    expect(pregunta.botones?.map((f) => f[0]?.texto)).toEqual(['Angelo', 'Javier', 'Isaac', 'Karen', 'Efectivo', 'Cancelar']);
    await e.pulsar(IDS.javier, IDS.grupoSocios, pregunta, 4, 0);
    expect(e.ultimoGrupo().texto).toContain('Cuenta donde entro: Efectivo');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('la firma del acta es personal: otro socio no puede firmar por quien la pide', async () => {
    const e = escenario([{ acciones: [{ tipo: 'ninguna' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    await e.socio('javier', '/firmaracta');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 0);
    // Angelo no confirma lo que pidio Javier: no se firma nada y la tarjeta vuelve a mostrarse para quien la pidio.
    expect(e.textosGrupo().some((t) => t.includes('Lo pidio Javier: lo confirma el'))).toBe(true);
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('Omar no puede usar los comandos nuevos y se avisa a los socios', async () => {
    const e = escenario([{ acciones: [{ tipo: 'ninguna' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    await e.omar('/merma jupiter/uva 2 | roto');
    expect(e.textosOmar().at(-1)).toContain('Eso lo registran los duenos');
    expect(e.textosGrupo().at(-1)).toContain('Omar escribio algo que solo registran los socios');
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });

  it('limite de frecuencia: con demasiados mensajes en el minuto no se procesa nada', async () => {
    const e = escenario([{ acciones: [{ tipo: 'ninguna' }], sospecha_inyeccion: false, baja_certeza: false }], ESTRICTO);
    e.almacen.mensajesRecientes = async () => 99;
    const r = await e.socio('angelo', '/cuadra');
    expect(r).toEqual({ estado: 'ignorado', motivo: 'limite_frecuencia' });
    expect(e.ultimoGrupo().texto).toContain('Demasiados mensajes');
    expect(e.almacen.eventos.some((x) => x.tipo === 'limite_frecuencia')).toBe(true);
  });
});
