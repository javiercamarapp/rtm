import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ceilDiv } from '@/dominio/dinero/techo';
import { participacionPorConsumo, reglaDelMayor } from '@/dominio/costos/atribucion';
import { atribuidoOrigMicro, calcularMonto, montoRespetaExacto, TC_UNO } from '@/dominio/costos/cargo';
import { conciliar } from '@/dominio/costos/conciliacion';
import { leerUsoClaude, participacionClaude } from '@/dominio/costos/claude';
import { ErrorCostos } from '@/dominio/costos/errores';
import { consumoDelMes, comisionDeRecarga, mesDeInstante, type LlamadaIa } from '@/dominio/costos/openrouter';
import { calcularCargo, calcularReversa, identificar, type ComandoCargo } from '@/dominio/costos/registro';
import { repartoMitades } from '@/dominio/costos/reparto';
import { resumenDelMes } from '@/dominio/costos/resumen';
import { CUENTAS, lineasDeEvento, reversaDeLineas, verificarCuadre } from '@/dominio/costos/eventos';
import { deudaEntreSocios, posicionTrasGastos, saldoPorPagar, validarReembolso } from '@/dominio/costos/cuenta';
import type { CargoCosto } from '@/dominio/costos/tipos';

const TC = { tcMicro: 18_500_000n, fecha: '2026-11-10', fuente: 'banxico_fix' as const };
const SHA = 'a'.repeat(64);
const usd = (dolares: number, centavos = 0) => BigInt(dolares) * 1_000_000n + BigInt(centavos) * 10_000n;

function cmd(parcial: Partial<ComandoCargo> & Pick<ComandoCargo, 'servicioSlug' | 'baseOrigMicro' | 'atribucion'>): ComandoCargo {
  return {
    claveIdem: `k-${parcial.servicioSlug}`,
    categoria: 'nube',
    mes: '2026-11',
    fechaNeg: '2026-11-10',
    fase: 'mantenimiento',
    moneda: 'USD',
    pagadoPor: 'javier',
    cobrable: true,
    etiqueta: 'atribuido',
    evidenciaTipo: 'recibo',
    evidenciaSha256: SHA,
    nota: '',
    ...parcial,
  };
}

let n = 0;
function cargo(c: ComandoCargo): CargoCosto {
  n += 1;
  return identificar(calcularCargo(c, TC), `id-${n}`, `K-${String(n).padStart(4, '0')}`).cargo;
}

describe('caso 1 del informe 17: mes completo', () => {
  const vercel = cargo(cmd({ servicioSlug: 'vercel', baseOrigMicro: usd(32), atribucion: { tipo: 'participacion', consumoRtm: 60n, consumoTotal: 1200n } }));
  const supabase = cargo(cmd({ servicioSlug: 'supabase', baseOrigMicro: usd(75), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } }));
  const openrouter = cargo(cmd({ servicioSlug: 'openrouter', categoria: 'ia', baseOrigMicro: usd(4, 20), atribucion: { tipo: 'directa' }, etiqueta: 'medido', evidenciaTipo: 'libro' }));
  const comision = cargo(cmd({ servicioSlug: 'openrouter_comision', categoria: 'ia', baseOrigMicro: usd(4, 20), atribucion: { tipo: 'tasa', ppm: 55_000n } }));
  const transcripcion = cargo(cmd({ servicioSlug: 'transcripcion', categoria: 'ia', baseOrigMicro: usd(1, 20), atribucion: { tipo: 'directa' } }));
  const dominio = cargo(cmd({ servicioSlug: 'dominio', categoria: 'dominio', baseOrigMicro: usd(1, 25), atribucion: { tipo: 'directa' } }));
  const claude = cargo(cmd({ servicioSlug: 'claude_max', categoria: 'software', baseOrigMicro: usd(200), atribucion: { tipo: 'participacion', consumoRtm: 176n, consumoTotal: 1000n }, etiqueta: 'estimado_prorrateado' }));

  it('reproduce el MXN exacto y el redondeado de cada cargo', () => {
    expect([vercel.exactoMxnE6, vercel.montoCent]).toEqual([29_600_000n * 100n, 3000n].map((v, i) => (i === 0 ? 2960n * 1_000_000n : v)));
    expect(supabase.pctExactoPpm).toBe(166_666n);
    expect(supabase.pctAplicadoPpm).toBe(170_000n);
    expect(supabase.exactoMxnE6).toBe(23_587_500_000n); // 235.875
    expect(supabase.montoCent).toBe(23_600n);
    expect(openrouter.exactoMxnE6).toBe(7_770n * 1_000_000n);
    expect(openrouter.montoCent).toBe(7_800n);
    expect(comision.exactoMxnE6).toBe(427_350_000n); // 4.2735
    expect(comision.montoCent).toBe(500n);
    expect(transcripcion.montoCent).toBe(2_300n);
    expect(dominio.exactoMxnE6).toBe(2_312_500_000n); // 23.125
    expect(dominio.montoCent).toBe(2_400n);
    expect(claude.pctAplicadoPpm).toBe(180_000n);
    expect(claude.montoCent).toBe(66_600n);
    expect(claude.exactoPuroMxnE6).toBe(65_120n * 1_000_000n); // 651.20 con 17.6 %
  });

  const cargos = [vercel, supabase, openrouter, comision, transcripcion, dominio, claude];
  const r = resumenDelMes('2026-11', cargos);

  it('operar: USD 21.23, MXN exacto 392.77, redondeado 396 (suma de cargos redondeados)', () => {
    expect(r.operar.redondeadoCent).toBe(39_600n);
    expect(r.operar.exactoE6 / 1_000_000n).toBe(39_277n); // 392.77 (truncado a centavos)
    expect(r.operar.usdMicro / 10_000n).toBe(2_123n); // 21.23
  });

  it('gasto total: exacto 1,043.97, redondeado 1,062, diferencia 18.03, mostrados por separado', () => {
    expect(r.total.redondeadoCent).toBe(106_200n);
    // La spec 17 suma el exacto de operar (con el punto ya techado, 235.875 de Supabase) al exacto de Claude con 17.6 %.
    const exactoDeLaSpec = r.operar.exactoE6 + claude.exactoPuroMxnE6;
    expect(exactoDeLaSpec / 1_000_000n).toBe(104_397n); // 1,043.97
    // El total exacto y el redondeado son campos distintos y nunca el mismo valor.
    expect(r.total.exactoE6 * 1n).not.toBe(r.total.redondeadoCent * 1_000_000n);
    const difPuraE6 = r.total.redondeadoCent * 1_000_000n - exactoDeLaSpec; // 18.0265 pesos
    expect(ceilDiv(difPuraE6, 1_000_000n)).toBe(1_803n); // 18.03 al mostrar
    expect(r.total.diferenciaE6 > 0n).toBe(true);
  });

  it('la suma de las partes redondeadas nunca es menor que el total exacto', () => {
    expect(r.total.redondeadoCent * 1_000_000n >= r.total.exactoE6).toBe(true);
    expect(r.total.redondeadoCent * 1_000_000n >= r.total.exactoPuroE6).toBe(true);
    expect(r.total.exactoPuroE6 <= r.total.exactoE6).toBe(true);
  });

  it('mitades: Angelo 531.00 y Javier 531.00; cada par suma el cargo', () => {
    const partes = cargos.map((c) => repartoMitades(c.montoCent));
    expect(partes.reduce((a, p) => a + p.angelo, 0n)).toBe(53_100n);
    expect(partes.reduce((a, p) => a + p.javier, 0n)).toBe(53_100n);
    cargos.forEach((c, i) => expect(partes[i]!.angelo + partes[i]!.javier).toBe(c.montoCent));
  });

  it('con construccion: separada del total hasta encender el interruptor; con faltantes dice "al menos"', () => {
    const constr = cargo(cmd({ servicioSlug: 'claude_max', claveIdem: 'k-constr', fase: 'construccion', categoria: 'software', baseOrigMicro: usd(200), atribucion: { tipo: 'participacion', consumoRtm: 8n, consumoTotal: 100n } }));
    const sin = resumenDelMes('2026-11', [...cargos, constr]);
    const con = resumenDelMes('2026-11', [...cargos, constr], { incluirConstruccion: true, faltantes: ['supabase'] });
    expect(sin.construccion.redondeadoCent).toBe(constr.montoCent);
    expect(sin.total.redondeadoCent).toBe(106_200n);
    expect(con.total.redondeadoCent).toBe(106_200n + constr.montoCent);
    expect(sin.alMenos).toBe(false);
    expect(con.alMenos).toBe(true);
    expect(con.faltantes).toEqual(['supabase']);
  });
});

describe('regla del mayor (decision 20, punto 2)', () => {
  it('Vercel: cuota del documento (US$20) gana a una participacion pequena; muestra las dos columnas', () => {
    const r = reglaDelMayor({ facturaOrigMicro: usd(32), cuotaDocumentoOrigMicro: usd(20), participacionAplicadaPpm: 50_000n, tcMicro: 18_500_000n });
    expect(r.base).toBe('cuota_documento');
    expect(r.comoSeria.montoCent).toBe(37_000n); // 370.00
    expect(r.comoDeberia.montoCent).toBe(3_000n); // 29.60 -> 30
    expect(r.cobrado.montoCent).toBe(37_000n);
    expect(r.diferenciaCent).toBe(34_000n);
  });
  it('Supabase: si el consumo real supera la cuota, gana el consumo', () => {
    const r = reglaDelMayor({ facturaOrigMicro: usd(200), cuotaDocumentoOrigMicro: usd(25), participacionAplicadaPpm: 400_000n, tcMicro: 18_500_000n });
    expect(r.base).toBe('consumo_real');
    expect(r.cobrado.montoCent).toBe(r.comoDeberia.montoCent);
    expect(r.diferenciaCent).toBe(0n);
  });
  it('empate: gana el consumo real', () => {
    const r = reglaDelMayor({ facturaOrigMicro: usd(100), cuotaDocumentoOrigMicro: usd(25), participacionAplicadaPpm: 250_000n, tcMicro: TC_UNO });
    expect(r.base).toBe('consumo_real');
  });
  it('el cobrado es siempre el mayor y nunca menor que ninguna columna (propiedad)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.bigInt({ min: 0n, max: 10n ** 9n }), fc.bigInt({ min: 0n, max: 100n }), fc.bigInt({ min: 1n, max: 40_000_000n }), (f, c, pts, tc) => {
        const r = reglaDelMayor({ facturaOrigMicro: f, cuotaDocumentoOrigMicro: c, participacionAplicadaPpm: pts * 10_000n, tcMicro: tc });
        expect(r.cobrado.montoCent >= r.comoSeria.montoCent).toBe(true);
        expect(r.cobrado.montoCent >= r.comoDeberia.montoCent).toBe(true);
        expect(r.diferenciaCent >= 0n).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
  it('un cargo con la regla del mayor guarda ambas columnas y cobra la cuota', () => {
    const c = cargo(cmd({ servicioSlug: 'vercel', claveIdem: 'k-mayor', baseOrigMicro: usd(32), atribucion: { tipo: 'mayor', cuotaDocumentoOrigMicro: usd(20), consumoRtm: 60n, consumoTotal: 1200n } }));
    expect(c.comoSeriaCent).toBe(37_000n);
    expect(c.comoDeberiaCent).toBe(3_000n);
    expect(c.montoCent).toBe(37_000n);
    expect(c.baseOrigMicro).toBe(usd(20));
    const rev = identificar(calcularReversa(c, 'k-rev', '2026-11-11', 'error'), 'r1', 'K-9999').cargo;
    expect(rev.comoSeriaCent).toBe(-37_000n);
  });
});

describe('atribucion por consumo', () => {
  it('participacion: 10 de 60 -> 16.67 % exacto, 17 % aplicado', () => {
    expect(participacionPorConsumo(10n, 60n)).toEqual({ exactoPpm: 166_666n, aplicadoPpm: 170_000n });
  });
  it('sin consumo total o consumo imposible no hay dato', () => {
    expect(() => participacionPorConsumo(1n, 0n)).toThrowError(ErrorCostos);
    expect(() => participacionPorConsumo(5n, 4n)).toThrowError(ErrorCostos);
    expect(() => participacionPorConsumo(-1n, 4n)).toThrowError(ErrorCostos);
  });
  it('caso 4: participacion exacta 18.00 % se queda en 18 %', () => {
    expect(participacionPorConsumo(18n, 100n).aplicadoPpm).toBe(180_000n);
  });
  it('la participacion aplicada nunca es menor que la real (propiedad)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 12n }), fc.bigInt({ min: 1n, max: 10n ** 12n }), (a, b) => {
        const rtm = a > b ? b : a;
        const p = participacionPorConsumo(rtm, b);
        expect(p.aplicadoPpm * b >= rtm * 1_000_000n).toBe(true);
        expect(p.aplicadoPpm <= 1_000_000n).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe('calculo de cargos: invariantes', () => {
  it('monto >= exacto y exacto nunca excede al monto real (propiedad con negativos)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 10n), max: 10n ** 10n }), fc.bigInt({ min: 0n, max: 1_000_000n }), fc.bigInt({ min: 1n, max: 40_000_000n }), (base, pct, tc) => {
        const m = calcularMonto({ baseOrigMicro: base, moneda: 'USD', pctAplicadoPpm: pct, tcMicro: tc });
        expect(montoRespetaExacto(m.montoCent, m.exactoMxnE6)).toBe(true);
        expect(m.montoCent % 100n).toBe(0n);
        expect(m.montoCent * 10n ** 16n >= m.numerador).toBe(true);
      }),
      { numRuns: 500 },
    );
  });
  it('porcentaje y tipo de cambio invalidos se rechazan con error tipado', () => {
    expect(() => calcularMonto({ baseOrigMicro: 1n, moneda: 'USD', pctAplicadoPpm: 1_000_001n, tcMicro: 1n })).toThrowError(ErrorCostos);
    expect(() => calcularMonto({ baseOrigMicro: 1n, moneda: 'USD', pctAplicadoPpm: -1n, tcMicro: 1n })).toThrowError(ErrorCostos);
    expect(() => calcularMonto({ baseOrigMicro: 1n, moneda: 'USD', pctAplicadoPpm: 1n, tcMicro: 0n })).toThrowError(ErrorCostos);
  });
  it('atribuidoOrigMicro trunca (solo informativo)', () => {
    expect(atribuidoOrigMicro(usd(75), 170_000n)).toBe(12_750_000n);
  });
  it('USD sin tipo de cambio: dato faltante, no se inventa', () => {
    expect(() => calcularCargo(cmd({ servicioSlug: 'x', baseOrigMicro: 1n, atribucion: { tipo: 'directa' } }), null)).toThrowError(/Sin tipo de cambio/);
  });
  it('MXN no necesita tipo de cambio', () => {
    const c = calcularCargo(cmd({ servicioSlug: 'x', moneda: 'MXN', baseOrigMicro: 236_000_000n, atribucion: { tipo: 'directa' } }), null);
    expect(c.montoCent).toBe(23_600n);
  });
  it('comando invalido: sin clave, mes mal formado, confirmar sin evidencia', () => {
    expect(() => calcularCargo(cmd({ servicioSlug: 'x', claveIdem: '', baseOrigMicro: 1n, atribucion: { tipo: 'directa' } }), TC)).toThrowError(/clave/);
    expect(() => calcularCargo(cmd({ servicioSlug: 'x', mes: '2026-13', baseOrigMicro: 1n, atribucion: { tipo: 'directa' } }), TC)).toThrowError(/Mes/);
    expect(() => calcularCargo(cmd({ servicioSlug: 'x', baseOrigMicro: 1n, evidenciaSha256: null, confirmar: true, atribucion: { tipo: 'directa' } }), TC)).toThrowError(/evidencia/);
  });
  it('sin evidencia el cargo queda provisional; con tipo de cambio de hace mas de 4 dias, tambien', () => {
    const sin = calcularCargo(cmd({ servicioSlug: 'x', baseOrigMicro: usd(1), evidenciaSha256: null, atribucion: { tipo: 'directa' } }), TC);
    expect(sin.estado).toBe('provisional');
    const viejo = calcularCargo(cmd({ servicioSlug: 'x', baseOrigMicro: usd(1), atribucion: { tipo: 'directa' }, fechaNeg: '2026-11-20' }), TC);
    expect(viejo.estado).toBe('provisional');
    const ok = calcularCargo(cmd({ servicioSlug: 'x', baseOrigMicro: usd(1), atribucion: { tipo: 'directa' }, fechaNeg: '2026-11-14' }), TC);
    expect(ok.estado).toBe('confirmado');
  });
});

describe('caso 3: centavo impar y notas de credito', () => {
  it('101 centavos -> Angelo 51, Javier 50', () => {
    expect(repartoMitades(101n)).toEqual({ angelo: 51n, javier: 50n });
  });
  it('nota de credito de -1.50 pesos reduce el gasto en 1.00 (techo) y se reparte -50 / -50', () => {
    const c = calcularCargo(cmd({ servicioSlug: 'x', moneda: 'MXN', baseOrigMicro: -1_500_000n, atribucion: { tipo: 'directa' } }), null);
    expect(c.montoCent).toBe(-100n);
    expect(repartoMitades(c.montoCent)).toEqual({ angelo: -50n, javier: -50n });
  });
  it('angelo + javier = monto para cualquier monto (propiedad)', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }), (m) => {
        const p = repartoMitades(m);
        expect(p.angelo + p.javier).toBe(m);
      }),
    );
  });
});

describe('OpenRouter: libro, comision y conciliacion', () => {
  const llamada = (ts: string, costo: bigint, estado: LlamadaIa['estado'] = 'liquidada', rol: LlamadaIa['rol'] = 'texto_simple', modelo = 'm1'): LlamadaIa => ({ ts, rol, modelo, costoUsdMicro: costo, estado });
  it('suma solo llamadas liquidadas del mes de Merida, por rol y modelo', () => {
    const libro = [
      llamada('2026-11-01T05:59:59Z', 1_000_000n), // 31-oct 23:59 Merida: octubre
      llamada('2026-11-01T06:00:00Z', 2_000_000n), // 1-nov 00:00 Merida: noviembre
      llamada('2026-11-15T12:00:00Z', 2_200_000n, 'liquidada', 'audio', 'm2'),
      llamada('2026-11-16T12:00:00Z', 900_000n, 'reservada'),
      llamada('2026-11-17T12:00:00Z', 900_000n, 'fallida'),
    ];
    const c = consumoDelMes(libro, '2026-11');
    expect(c.totalUsdMicro).toBe(4_200_000n);
    expect(c.llamadas).toBe(2);
    expect(c.porRol).toEqual({ texto_simple: 2_000_000n, audio: 2_200_000n });
    expect(c.porModelo).toEqual({ m1: 2_000_000n, m2: 2_200_000n });
    expect(consumoDelMes(libro, '2026-10').totalUsdMicro).toBe(1_000_000n);
  });
  it('mes de Merida: 02:00 UTC del dia 1 es todavia el mes anterior', () => {
    expect(mesDeInstante('2026-12-01T02:00:00Z')).toBe('2026-11');
    expect(() => mesDeInstante('no-es-fecha')).toThrowError(ErrorCostos);
  });
  it('costo negativo en el libro se rechaza', () => {
    expect(() => consumoDelMes([llamada('2026-11-02T12:00:00Z', -1n)], '2026-11')).toThrowError(ErrorCostos);
  });
  it('caso 6: comision 5.5 % con interruptor; apagada queda en memo sin asiento', () => {
    const on = comisionDeRecarga(usd(4, 20), 55_000n, true, 18_500_000n);
    expect(on.calculo.montoCent).toBe(500n);
    expect(on.enAsiento).toBe(true);
    const off = comisionDeRecarga(usd(4, 20), 55_000n, false, 18_500_000n);
    expect(off.enAsiento).toBe(false);
    expect(off.calculo.montoCent).toBe(500n); // se conserva en el memo
  });
  it('caso 5: libro 4.20 vs /key 4.22 cuadra; 4.60 queda fuera de tolerancia', () => {
    expect(conciliar(usd(4, 20), usd(4, 22)).estado).toBe('cuadra');
    const fuera = conciliar(usd(4, 20), usd(4, 60));
    expect(fuera.estado).toBe('fuera_de_tolerancia');
    expect(fuera.diferenciaUsdMicro).toBe(400_000n);
    expect(conciliar(0n, 0n).estado).toBe('cuadra');
    expect(conciliar(0n, 1n).estado).toBe('fuera_de_tolerancia');
    expect(conciliar(usd(1), usd(1) + 20_000n * 1n).estado).toBe('cuadra'); // justo en 2 %
  });
});

describe('Claude: lectura del JSON y participacion', () => {
  const json = {
    mes: '2026-11',
    script_version: '1.0.0',
    metricas: {
      entrada_salida_escritura_cache: { tokens_rtm: 77, tokens_cuenta: 1000 },
      solo_salida: { tokens_rtm: 123, tokens_cuenta: 1000 },
      todo_con_lectura_cache: { tokens_rtm: '44', tokens_cuenta: '1000' },
    },
  };
  it('7.7 % de la metrica principal -> 8 % (decision 20)', () => {
    const uso = leerUsoClaude(json);
    expect(participacionClaude(uso.principal)).toEqual({ exactoPpm: 77_000n, aplicadoPpm: 80_000n });
    expect(participacionClaude(uso.soloSalida).aplicadoPpm).toBe(130_000n);
    expect(participacionClaude(uso.conLecturaCache).aplicadoPpm).toBe(50_000n);
  });
  it('JSON invalido o sin dato no produce 0 ni la mensualidad completa: falla', () => {
    expect(() => leerUsoClaude(null)).toThrowError(ErrorCostos);
    expect(() => leerUsoClaude({ mes: '2026-11' })).toThrowError(ErrorCostos);
    expect(() => leerUsoClaude({ ...json, metricas: { ...json.metricas, solo_salida: null } })).toThrowError(ErrorCostos);
    expect(() => leerUsoClaude({ ...json, metricas: { ...json.metricas, solo_salida: { tokens_rtm: 5, tokens_cuenta: 1 } } })).toThrowError(ErrorCostos);
    expect(() => leerUsoClaude({ ...json, metricas: { ...json.metricas, solo_salida: { tokens_rtm: 1.5, tokens_cuenta: 3 } } })).toThrowError(ErrorCostos);
    expect(() => participacionClaude({ tokensRtm: 0n, tokensCuenta: 0n })).toThrowError(ErrorCostos);
    expect(leerUsoClaude({ mes: '2026-11', metricas: json.metricas }).scriptVersion).toBe('desconocida');
  });
});

describe('asientos', () => {
  it('cargo registrado: Dr gasto / Cr cuenta por pagar a Javier; cuadra', () => {
    const l = lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: 'nube', montoCent: 23_600n, pagadoPor: 'javier' });
    expect(l).toEqual([
      { cuenta: CUENTAS.gasto.nube, debeCent: 23_600n, haberCent: 0n },
      { cuenta: CUENTAS.porPagar.javier, debeCent: 0n, haberCent: 23_600n },
    ]);
  });
  it('todos los eventos cuadran (propiedad) y la reversa invierte los lados', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 9n), max: 10n ** 9n }), fc.constantFrom('nube', 'ia', 'software', 'dominio' as const), (m, cat) => {
        const eventos = [
          lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: cat, montoCent: m, pagadoPor: 'javier' }),
          lineasDeEvento({ tipo: 'costo_cargo_anual', montoCent: m, pagadoPor: 'angelo' }),
          lineasDeEvento({ tipo: 'costo_devengo_mensual', montoCent: m, categoria: cat }),
          lineasDeEvento({ tipo: 'costo_recarga_ia', montoCent: m, pagadoPor: 'javier' }),
          lineasDeEvento({ tipo: 'costo_consumo_ia', montoCent: m }),
          lineasDeEvento({ tipo: 'reembolso_costos', montoCent: m, aSocio: 'javier', fondosDe: 'angelo' }),
        ];
        for (const l of eventos) {
          verificarCuadre(l);
          verificarCuadre(reversaDeLineas(l));
        }
      }),
      { numRuns: 200 },
    );
  });
  it('monto negativo (nota de credito) invierte lados; cero no genera lineas; conciliado sin lineas', () => {
    const neg = lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: 'ia', montoCent: -100n, pagadoPor: 'javier' });
    expect(neg[0]).toEqual({ cuenta: CUENTAS.porPagar.javier, debeCent: 100n, haberCent: 0n });
    expect(lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: 'ia', montoCent: 0n, pagadoPor: 'javier' })).toEqual([]);
    expect(lineasDeEvento({ tipo: 'costo_conciliado' })).toEqual([]);
  });
  it('el reembolso cancela la cuenta por pagar contra los fondos de la sociedad', () => {
    expect(lineasDeEvento({ tipo: 'reembolso_costos', montoCent: 34_400n, aSocio: 'javier', fondosDe: 'javier' })).toEqual([
      { cuenta: CUENTAS.porPagar.javier, debeCent: 34_400n, haberCent: 0n },
      { cuenta: CUENTAS.fondos.javier, debeCent: 0n, haberCent: 34_400n },
    ]);
  });
  it('un asiento descuadrado o con lineas negativas se rechaza', () => {
    expect(() => verificarCuadre([{ cuenta: '1', debeCent: 1n, haberCent: 0n }])).toThrowError(ErrorCostos);
    expect(() => verificarCuadre([{ cuenta: '1', debeCent: -1n, haberCent: 0n }])).toThrowError(ErrorCostos);
  });
});

describe('caso 2 del informe 17: tres cargos (Vercel 30, Supabase 236, OpenRouter 78 = 344)', () => {
  const tres = [
    cargo(cmd({ servicioSlug: 'vercel', claveIdem: 'c2-v', baseOrigMicro: usd(32), atribucion: { tipo: 'participacion', consumoRtm: 60n, consumoTotal: 1200n } })),
    cargo(cmd({ servicioSlug: 'supabase', claveIdem: 'c2-s', baseOrigMicro: usd(75), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } })),
    cargo(cmd({ servicioSlug: 'openrouter', claveIdem: 'c2-o', categoria: 'ia', baseOrigMicro: usd(4, 20), atribucion: { tipo: 'directa' } })),
  ];
  const antes = { angelo: 8_461_500n, javier: 5_600_000n };
  it('gasto total 344 y mitad de Angelo 172', () => {
    expect(tres.map((c) => c.montoCent)).toEqual([3000n, 23_600n, 7800n]);
    expect(tres.reduce((a, c) => a + c.montoCent, 0n)).toBe(34_400n);
    expect(tres.reduce((a, c) => a + repartoMitades(c.montoCent).angelo, 0n)).toBe(17_200n);
  });
  it('posicion: Pos(J) 56,344.00 y la diferencia baja 172.00 (14,307.50 -> 14,135.50)', () => {
    expect(deudaEntreSocios(antes)).toEqual({ deudor: 'javier', montoCent: 1_430_750n });
    const despues = posicionTrasGastos(antes, tres);
    expect(despues.javier).toBe(5_634_400n);
    expect(despues.angelo).toBe(8_461_500n);
    expect(deudaEntreSocios(despues)).toEqual({ deudor: 'javier', montoCent: 1_413_550n });
    expect(1_430_750n - 1_413_550n).toBe(17_200n);
  });
  it('cuenta por pagar de la sociedad a Javier: 344.00 cargado, 0 reembolsado; los gastos no cobrables no suman', () => {
    const s = saldoPorPagar('javier', tres, []);
    expect(s).toEqual({ socio: 'javier', cargadoCent: 34_400n, reembolsadoCent: 0n, pendienteCent: 34_400n });
    const noCobrable = cargo(cmd({ servicioSlug: 'x', claveIdem: 'c2-nc', cobrable: false, baseOrigMicro: usd(1), atribucion: { tipo: 'directa' } }));
    expect(saldoPorPagar('javier', [...tres, noCobrable], []).pendienteCent).toBe(34_400n);
    expect(posicionTrasGastos(antes, [noCobrable])).toEqual(antes);
  });
  it('un gasto pagado por Angelo sube su posicion y su cuenta por pagar', () => {
    const deAngelo = cargo(cmd({ servicioSlug: 'x', claveIdem: 'c2-a', pagadoPor: 'angelo', moneda: 'MXN', baseOrigMicro: 100_000_000n, atribucion: { tipo: 'directa' } }));
    expect(posicionTrasGastos(antes, [deAngelo]).angelo).toBe(antes.angelo + 10_000n);
    expect(saldoPorPagar('angelo', [deAngelo], []).pendienteCent).toBe(10_000n);
  });
  it('validarReembolso: positivo y sin exceder lo pendiente', () => {
    expect(() => validarReembolso(0n, 100n)).toThrowError(ErrorCostos);
    expect(() => validarReembolso(101n, 100n)).toThrowError(ErrorCostos);
    expect(() => validarReembolso(100n, 100n)).not.toThrow();
  });
  it('deudaEntreSocios: en paz y con Angelo como deudor', () => {
    expect(deudaEntreSocios({ angelo: 5n, javier: 5n })).toEqual({ deudor: null, montoCent: 0n });
    expect(deudaEntreSocios({ angelo: 1n, javier: 4n })).toEqual({ deudor: 'angelo', montoCent: 2n });
  });
});

describe('reversa de un cargo', () => {
  it('copia los montos guardados con signo contrario sin recalcular y apunta al original', () => {
    const orig = cargo(cmd({ servicioSlug: 'supabase', claveIdem: 'rev-o', baseOrigMicro: usd(75), atribucion: { tipo: 'participacion', consumoRtm: 10n, consumoTotal: 60n } }));
    const rev = identificar(calcularReversa(orig, 'rev-1', '2026-11-11', 'duplicado'), 'rid', 'K-0900');
    expect(rev.cargo.montoCent).toBe(-orig.montoCent);
    expect(rev.cargo.exactoMxnE6).toBe(-orig.exactoMxnE6);
    expect(rev.cargo.reversaDe).toBe(orig.id);
    expect(rev.cargo.estado).toBe('anulado');
    const suma = [...lineasDeEvento({ tipo: 'costo_cargo_registrado', categoria: 'nube', montoCent: orig.montoCent, pagadoPor: 'javier' }), ...rev.lineas];
    // Efecto neto en cada cuenta: cero.
    const neto = new Map<string, bigint>();
    for (const l of suma) neto.set(l.cuenta, (neto.get(l.cuenta) ?? 0n) + l.debeCent - l.haberCent);
    expect([...neto.values()].every((v) => v === 0n)).toBe(true);
    expect(resumenDelMes('2026-11', [orig, rev.cargo]).total.redondeadoCent).toBe(0n);
    expect(() => calcularReversa(rev.cargo, 'otra', '2026-11-12', '')).toThrowError(ErrorCostos);
    expect(Object.isFrozen(rev.cargo)).toBe(true);
  });
});
