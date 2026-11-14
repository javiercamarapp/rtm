import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  CADENAS,
  ErrorPoliticaModelos,
  MODELOS,
  TECHO_ENTRADA_MICRO_POR_MTOK,
  TECHO_SALIDA_MICRO_POR_MTOK,
  cadenaParaRol,
  compararLecturas,
  dentroDelTecho,
  esProhibido,
  exigirPermitido,
  peorCasoAudio,
  peorCasoTokens,
  type RolIa,
} from '@/dominio/agente/modelos';
import { permisoParaIntencion, puedePulsar } from '@/dominio/agente/permisos';
import type { Intencion } from '@/dominio/agente/intenciones';
import {
  REPARTO_DIA_MICRO,
  TOPE_DIA_MICRO,
  TOPE_MES_MICRO,
  aplicarLiberacion,
  aplicarLiquidacion,
  estadoInicial,
  evaluarReserva,
  rotar,
} from '@/dominio/agente/presupuesto';
import { VENTANA_DESHACER_MIN, contramovimiento, evaluarDeshacer, sumaNeta, type HechoAplicado } from '@/dominio/agente/deshacer';

describe('politica 19: modelos', () => {
  const roles = Object.keys(CADENAS) as RolIa[];
  it('toda cadena de todo rol esta dentro del techo y sin modelos eliminados', () => {
    for (const r of roles) {
      for (const m of cadenaParaRol(r)) {
        expect(m.entradaMicroPorMtok).toBeLessThanOrEqual(TECHO_ENTRADA_MICRO_POR_MTOK);
        expect(m.salidaMicroPorMtok).toBeLessThanOrEqual(TECHO_SALIDA_MICRO_POR_MTOK);
        expect(esProhibido(m.slug)).toBe(false);
      }
    }
  });
  it('texto: Haiku 5.5, respaldo GPT-6 Luna, luego DeepSeek V4.1 Flash', () => {
    expect(cadenaParaRol('texto').map((m) => m.slug)).toEqual(['anthropic/claude-haiku-5.5-20261007', 'openai/gpt-6-luna-20260922', 'deepseek/deepseek-v4.1-flash-20260910']);
  });
  it('fotos: Haiku con vision y segunda lectura independiente con Luna; redaccion Luna con respaldo Haiku', () => {
    expect(cadenaParaRol('vision')[0]!.slug).toBe('anthropic/claude-haiku-5.5-20261007');
    expect(cadenaParaRol('vision_segunda')[0]!.slug).toBe('openai/gpt-6-luna-20260922');
    expect(cadenaParaRol('redaccion').map((m) => m.slug)).toEqual(['openai/gpt-6-luna-20260922', 'anthropic/claude-haiku-5.5-20261007']);
    expect(cadenaParaRol('audio')[0]!.slug).toContain('whisper-large-v3-turbo');
  });
  it('Sonnet, Opus, Gemini y Qwen estan eliminados; un modelo sobre el techo exige autorizacion', () => {
    for (const s of ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5', 'google/gemini-3.1-flash-lite', 'qwen/qwen-3.7-flash', 'openai/gpt-6']) {
      expect(esProhibido(s)).toBe(true);
    }
    expect(() => exigirPermitido({ slug: 'x/modelo-caro', entradaMicroPorMtok: 3_000_000n, salidaMicroPorMtok: 15_000_000n, vision: false, chino: false })).toThrow(ErrorPoliticaModelos);
    expect(() => exigirPermitido({ ...MODELOS.haiku!, slug: 'anthropic/claude-sonnet-5.5' })).toThrow(/prohibido/);
    expect(dentroDelTecho({ ...MODELOS.haiku!, entradaMicroPorMtok: 250_000n, salidaMicroPorMtok: 1_500_000n })).toBe(false);
    expect(dentroDelTecho(MODELOS.haiku!)).toBe(true);
  });
  it('tabla corrupta: modelo desconocido o sin vision en rol de vision', () => {
    expect(() => cadenaParaRol('texto', { ...CADENAS, texto: ['nope'] })).toThrow(/desconocido/);
    expect(() => cadenaParaRol('vision', { ...CADENAS, vision: ['deepseek'] })).toThrow(/vision/);
  });
  it('peor caso: el del modelo mas caro del arreglo, redondeado hacia arriba', () => {
    const cadena = cadenaParaRol('texto');
    // 6,000 tokens de entrada y 700 de salida: Haiku/Luna 0.1/0.5; DeepSeek 0.051/0.567 -> el mayor es DeepSeek en salida
    const haiku = (6000n * 100_000n + 999_999n) / 1_000_000n + (700n * 500_000n + 999_999n) / 1_000_000n;
    const deep = (6000n * 51_000n + 999_999n) / 1_000_000n + (700n * 567_000n + 999_999n) / 1_000_000n;
    expect(peorCasoTokens(cadena, 6000, 700)).toBe(haiku > deep ? haiku : deep);
    expect(peorCasoTokens(cadena, 1, 1)).toBeGreaterThanOrEqual(2n);
    expect(peorCasoAudio(MODELOS.whisper!, 120)).toBe(3600n);
  });
  it('dos lecturas de una foto: si los montos no coinciden, se pregunta a un socio', () => {
    expect(compararLecturas({ montoCentavos: 700_000n }, { montoCentavos: 700_000n })).toEqual({ estado: 'coincide', montoCentavos: 700_000n });
    expect(compararLecturas({ montoCentavos: 700_000n }, { montoCentavos: 70_000n })).toEqual({ estado: 'discrepa' });
    expect(compararLecturas({ montoCentavos: null }, { montoCentavos: 1n })).toEqual({ estado: 'discrepa' });
  });
});

describe('permisos por rol', () => {
  const consulta = (c: Extract<Intencion, { tipo: 'consulta' }>['consulta'], sujeto: string | null = null): Intencion => ({ tipo: 'consulta', consulta: c, modelo_texto: null, sabor_texto: null, sujeto_texto: sujeto, folio: null, periodo: null });
  const toma: Intencion = { tipo: 'toma_omar', lineas: [{ modelo_texto: 'elux', sabor_texto: 'sandia', piezas: 3 }], fuente_cita: 'x' };
  it('socio: todo', () => {
    expect(permisoParaIntencion('socio', toma)).toEqual({ permitido: true });
    expect(permisoParaIntencion('socio', consulta('resumen'))).toEqual({ permitido: true });
  });
  it('Omar: toma, inventario, su saldo y ayuda', () => {
    expect(permisoParaIntencion('omar', toma).permitido).toBe(true);
    expect(permisoParaIntencion('omar', consulta('inventario')).permitido).toBe(true);
    expect(permisoParaIntencion('omar', consulta('ayuda')).permitido).toBe(true);
    expect(permisoParaIntencion('omar', consulta('saldo', 'omar')).permitido).toBe(true);
    expect(permisoParaIntencion('omar', consulta('saldo')).permitido).toBe(true);
    expect(permisoParaIntencion('omar', { tipo: 'ninguna' }).permitido).toBe(true);
    expect(permisoParaIntencion('omar', { tipo: 'aclarar', pregunta: '?' }).permitido).toBe(true);
  });
  it('Omar no ve saldos de otros ni utilidad, precios ni resumen', () => {
    expect(permisoParaIntencion('omar', consulta('saldo', 'socios'))).toEqual({ permitido: false, motivo: 'fuera_de_alcance' });
    expect(permisoParaIntencion('omar', consulta('saldo', 'karen'))).toEqual({ permitido: false, motivo: 'fuera_de_alcance' });
    for (const c of ['precio', 'resumen', 'liquidacion_proveedor', 'pendientes', 'explicar', 'pedido', 'saldo_proveedor'] as const) {
      expect(permisoParaIntencion('omar', consulta(c))).toEqual({ permitido: false, motivo: 'fuera_de_alcance' });
    }
  });
  it('Omar no registra pedidos, pagos, gastos, compras ni deshace', () => {
    const escrituras: Intencion[] = [
      { tipo: 'pedido', cliente_texto: 'x', destino_texto: null, lineas: [], envio_cobrado_centavos: null, fuente_cita: 'x' },
      { tipo: 'pago', cliente_texto: 'x', monto_centavos: 100, cuenta_destino_texto: null, pedido_folio: null, fuente_cita: 'x' },
      { tipo: 'gasto', gasto: 'uber', monto_centavos: 100, pagado_por: 'angelo', descripcion: null, fuente_cita: 'x' },
      { tipo: 'compra', proveedor_texto: 'karen', lineas: [], guia_centavos: null, pagado_por: null, fuente_cita: 'x' },
      { tipo: 'deshacer', folio: null },
    ];
    for (const e of escrituras) expect(permisoParaIntencion('omar', e)).toEqual({ permitido: false, motivo: 'omar_no_registra' });
  });
  it('botones de socios: Omar no puede pulsar', () => {
    expect(puedePulsar('socio', ['socio'])).toBe(true);
    expect(puedePulsar('omar', ['socio'])).toBe(false);
  });
});

describe('presupuesto: reserva antes de la llamada y corte al tope', () => {
  const dia = '2026-11-10';
  it('constantes de la politica: US$1/dia y US$30/mes', () => {
    expect(TOPE_DIA_MICRO).toBe(1_000_000n);
    expect(TOPE_MES_MICRO).toBe(30_000_000n);
    expect(Object.values(REPARTO_DIA_MICRO).reduce((a, b) => a + b, 0n)).toBe(TOPE_DIA_MICRO);
  });
  it('reservas sucesivas por debajo del 80 % no avisan', () => {
    let e = estadoInicial(dia);
    const r1 = evaluarReserva(e, 'texto', 500_000n, dia);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    e = r1.estado;
    expect(r1.avisos).toEqual([]);
    const r2 = evaluarReserva(e, 'vision', 250_000n, dia);
    if (!r2.ok) throw new Error('debio caber');
    expect(r2.avisos).toEqual([]); // 750,000 < 800,000: aun sin aviso
  });
  it('alerta al 80 % del dia (US$0.80) una sola vez', () => {
    let e = estadoInicial(dia);
    const a = evaluarReserva(e, 'texto', 500_000n, dia);
    if (!a.ok) throw new Error('x');
    e = a.estado;
    const b = evaluarReserva(e, 'redaccion', 100_000n, dia);
    if (!b.ok) throw new Error('x');
    e = b.estado;
    const c = evaluarReserva(e, 'vision', 200_000n, dia);
    if (!c.ok) throw new Error('x');
    expect(c.avisos).toEqual(['alerta_dia']);
    e = c.estado;
    const d = evaluarReserva(e, 'texto', 40_000n, dia);
    if (!d.ok) throw new Error('x');
    expect(d.avisos).toEqual([]);
  });
  it('corta al tope diario y deja libre la reserva del resumen', () => {
    let e = estadoInicial(dia);
    for (const [rol, monto] of [['texto', 550_000n], ['vision', 250_000n], ['redaccion', 100_000n], ['audio', 50_000n]] as const) {
      const r = evaluarReserva(e, rol, monto, dia);
      if (!r.ok) throw new Error(`no cupo ${rol}`);
      e = r.estado;
    }
    expect(evaluarReserva(e, 'texto', 1n, dia)).toEqual({ ok: false, motivo: 'tope_diario' });
    const resumen = evaluarReserva(e, 'resumen', 50_000n, dia);
    expect(resumen.ok).toBe(true);
  });
  it('tope por rol y monto invalido', () => {
    const e = estadoInicial(dia);
    expect(evaluarReserva(e, 'audio', 50_001n, dia)).toEqual({ ok: false, motivo: 'tope_rol' });
    expect(evaluarReserva(e, 'texto', 0n, dia)).toEqual({ ok: false, motivo: 'monto_invalido' });
    expect(evaluarReserva(e, 'texto', -5n, dia)).toEqual({ ok: false, motivo: 'monto_invalido' });
  });
  it('tope mensual de US$30', () => {
    const e = { ...estadoInicial(dia), mesMicro: 29_999_000n };
    expect(evaluarReserva(e, 'texto', 2_000n, dia)).toEqual({ ok: false, motivo: 'tope_mensual' });
    expect(evaluarReserva(e, 'texto', 1_000n, dia).ok).toBe(true);
    const e2 = { ...estadoInicial(dia), mesMicro: 24_000_000n };
    const r = evaluarReserva(e2, 'texto', 1_000n, dia);
    expect(r.ok && r.avisos).toEqual(['alerta_mes']);
  });
  it('rota al cambiar de dia y de mes', () => {
    const e = { ...estadoInicial('2026-11-30'), diaMicro: 900_000n, mesMicro: 5_000_000n, alertaDiaEnviada: true, alertaMesEnviada: true };
    const manana = rotar(e, '2026-12-01');
    expect(manana.diaMicro).toBe(0n);
    expect(manana.mesMicro).toBe(0n);
    expect(manana.alertaDiaEnviada).toBe(false);
    const otroDia = rotar(e, '2026-11-30');
    expect(otroDia).toEqual(e);
    expect(rotar({ ...e, fechaDia: '2026-11-29' }, '2026-11-30').mesMicro).toBe(5_000_000n);
  });
  it('liquidar sustituye la reserva por el costo real; liberar la devuelve', () => {
    const r = evaluarReserva(estadoInicial(dia), 'texto', 400_000n, dia);
    if (!r.ok) throw new Error('x');
    const liq = aplicarLiquidacion(r.estado, 'texto', 400_000n, 150_000n);
    expect(liq.estado.diaMicro).toBe(150_000n);
    expect(liq.estado.porRolDiaMicro.texto).toBe(150_000n);
    const lib = aplicarLiberacion(r.estado, 'texto', 400_000n);
    expect(lib.diaMicro).toBe(0n);
    // un costo real mayor a lo reservado se refleja (no se oculta)
    expect(aplicarLiquidacion(r.estado, 'texto', 400_000n, 450_000n).estado.diaMicro).toBe(450_000n);
    // nunca negativo
    expect(aplicarLiberacion(estadoInicial(dia), 'texto', 10n).diaMicro).toBe(0n);
  });
  it('propiedad: sea cual sea la secuencia de reservas, el comprometido nunca pasa de los topes', () => {
    const roles = ['texto', 'vision', 'audio', 'redaccion', 'resumen'] as const;
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom(...roles), fc.bigInt({ min: 1n, max: 400_000n })), { maxLength: 60 }), (pasos) => {
        let e = estadoInicial(dia);
        for (const [rol, monto] of pasos) {
          const r = evaluarReserva(e, rol, monto, dia);
          if (r.ok) e = r.estado;
          expect(e.diaMicro).toBeLessThanOrEqual(TOPE_DIA_MICRO);
          expect(e.mesMicro).toBeLessThanOrEqual(TOPE_MES_MICRO);
          for (const k of roles) expect(e.porRolDiaMicro[k]).toBeLessThanOrEqual(REPARTO_DIA_MICRO[k]);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('ventana de deshacer y contramovimiento', () => {
  const t0 = new Date('2026-11-10T18:00:00Z');
  const mas = (min: number) => new Date(t0.getTime() + min * 60_000);
  it(`un toque dentro de ${VENTANA_DESHACER_MIN} minutos y sin dependencias`, () => {
    expect(evaluarDeshacer({ ejecutadoEn: t0, ahora: mas(3), dependencias: 0 })).toEqual({ modo: 'un_toque' });
    expect(evaluarDeshacer({ ejecutadoEn: t0, ahora: mas(10), dependencias: 0 })).toEqual({ modo: 'un_toque' });
  });
  it('indicacion expresa con dependencias o fuera de ventana', () => {
    expect(evaluarDeshacer({ ejecutadoEn: t0, ahora: mas(1), dependencias: 2 })).toEqual({ modo: 'indicacion_expresa', motivo: 'dependencias' });
    expect(evaluarDeshacer({ ejecutadoEn: t0, ahora: mas(11), dependencias: 0 })).toEqual({ modo: 'indicacion_expresa', motivo: 'fuera_de_ventana' });
    expect(evaluarDeshacer({ ejecutadoEn: mas(5), ahora: t0, dependencias: 0 })).toEqual({ modo: 'indicacion_expresa', motivo: 'fuera_de_ventana' });
  });
  const hecho = (lineas: HechoAplicado['lineas']): HechoAplicado => ({ folio: 'P-0001', tipo: 'pedido', lineas, claveIdem: 'k', corrigeFolio: null });
  it('contramovimiento enlazado: original + contra = cero, y no se deshace un contra', () => {
    const o = hecho([{ concepto: 'Waka Jupiter 50K', piezas: -28, centavos: 700_000n }]);
    const c = contramovimiento(o, 'P-0002', 'k2');
    expect(c.corrigeFolio).toBe('P-0001');
    expect(c.tipo).toBe('contra_pedido');
    expect(sumaNeta([o, c])).toEqual({ piezas: 0, centavos: 0n });
    expect(() => contramovimiento(c, 'P-0003', 'k3')).toThrow(RangeError);
  });
  it('propiedad: para cualquier hecho, hecho + contramovimiento suma cero', () => {
    fc.assert(
      fc.property(fc.array(fc.record({ concepto: fc.string({ maxLength: 8 }), piezas: fc.integer({ min: -2000, max: 2000 }), centavos: fc.bigInt({ min: -1_000_000_000_000n, max: 1_000_000_000_000n }) }), { maxLength: 10 }), (lineas) => {
        const o = hecho(lineas);
        expect(sumaNeta([o, contramovimiento(o, 'X-1', 'k')])).toEqual({ piezas: 0, centavos: 0n });
      }),
      { numRuns: 300 },
    );
  });
});
