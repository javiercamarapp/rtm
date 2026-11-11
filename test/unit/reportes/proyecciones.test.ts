import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { coberturaViernes, diasEntre, escenarioConcentracion, escenarioCosto, escenarioMezcla, escenarioRetrasoCobro, estacionalidad, finDeMesOmar, flujoCaja, LEYENDA_ESTIMADO, noSeEstima, promedioMovilExponencial, proximoPedido, puntoReorden, t90, tendenciaLineal } from '@/dominio/reportes/proyecciones';
import type { FlujoInsumo } from '@/dominio/reportes/insumos';
import { PARAMETROS } from '@/dominio/reportes/parametros';

const constante = (n: number, v: number) => Array.from({ length: n }, () => v);

describe('promedio movil exponencial', () => {
  it('sin historia no se emite: faltan 6 semanas (minimo 6)', () => {
    const r = promedioMovilExponencial([], 4);
    expect(r.emite).toBe(false);
    if (!r.emite) {
      expect(r.faltan).toBe(6);
      expect(r.minimo).toBe(6);
      expect(r.razon).toBe('No se estima: faltan 6 semanas (mínimo 6)');
    }
  });
  it('con n = minimo - 1 no se emite y se imprime el faltante; con n = minimo se emite con el central dentro del rango', () => {
    const cinco = promedioMovilExponencial([100, 110, 90, 105, 95], 4);
    expect(cinco.emite).toBe(false);
    if (!cinco.emite) expect(cinco.razon).toContain('faltan 1 semanas');
    const seis = promedioMovilExponencial([100, 110, 90, 105, 95, 102], 4);
    expect(seis.emite).toBe(true);
    if (seis.emite) {
      expect(seis.clase).toBe('Estimado');
      expect(seis.leyenda).toBe(LEYENDA_ESTIMADO);
      for (const p of seis.datos.puntos) {
        expect(p.lo).toBeLessThanOrEqual(p.central);
        expect(p.hi).toBeGreaterThanOrEqual(p.central);
      }
    }
  });
  it('serie constante: central = constante y sigma = 0 (respuesta conocida)', () => {
    const r = promedioMovilExponencial(constante(8, 5000), 4);
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.central).toBeCloseTo(5000, 9);
      expect(r.datos.sigma).toBeCloseTo(0, 9);
      expect(r.datos.puntos[3]!.lo).toBeCloseTo(5000, 9);
    }
  });
  it('el rango crece con la raiz del horizonte', () => {
    const r = promedioMovilExponencial([100, 130, 80, 120, 90, 125, 85, 115], 4);
    expect(r.emite).toBe(true);
    if (r.emite) {
      const [a, , , d] = r.datos.puntos;
      expect(d!.hi - d!.central).toBeCloseTo((a!.hi - a!.central) * 2, 9);
    }
  });
  it('los huecos (null) no cuentan como dato; un pedido atipico se recorta al percentil 90', () => {
    const conHuecos = promedioMovilExponencial([100, null, 100, null, 100, 100, 100, 100], 1);
    expect(conHuecos.emite).toBe(true);
    const atipico = promedioMovilExponencial([100, 100, 100, 100, 100, 100, 100, 10_000], 1);
    expect(atipico.emite).toBe(true);
    if (atipico.emite) expect(atipico.datos.central).toBeLessThan(2000);
  });
  it('propiedad: el central siempre queda entre el minimo y el maximo de los datos', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 6, maxLength: 12 }), (xs) => {
        const r = promedioMovilExponencial(xs, 4);
        expect(r.emite).toBe(true);
        if (r.emite) {
          const w = xs.slice(-PARAMETROS.ventanaEma);
          expect(r.datos.central).toBeGreaterThanOrEqual(Math.min(...w) - 1e-6);
          expect(r.datos.central).toBeLessThanOrEqual(Math.max(...w) + 1e-6);
        }
      }),
      { numRuns: 200 },
    );
  });
  it('la ventana se rotula con fechas cuando hay inicios', () => {
    const inicios = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
    const r = promedioMovilExponencial(constante(8, 100), 2, inicios);
    expect(r.emite && r.ventana).toEqual({ n: 8, desde: '2026-09-07', hasta: '2026-11-01' });
  });
});

describe('tendencia lineal con intervalo', () => {
  it('menos de 8 semanas: no se emite', () => {
    const r = tendenciaLineal(constante(7, 10), 4);
    expect(r.emite).toBe(false);
    if (!r.emite) expect(r.razon).toContain('faltan 1 semanas');
  });
  it('horizonte mayor a 4 semanas: no se emite', () => {
    const r = tendenciaLineal(constante(10, 10), 5);
    expect(r.emite).toBe(false);
  });
  it('recta casi perfecta: usa tendencia y el intervalo contiene la recta', () => {
    const y = Array.from({ length: 10 }, (_, i) => 100 + 5 * i + (i % 2 ? 1 : -1));
    const r = tendenciaLineal(y, 4);
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.usaTendencia).toBe(true);
      expect(r.datos.pendiente).toBeCloseTo(5, 0);
      const p1 = r.datos.puntos[0]!;
      expect(p1.lo).toBeLessThan(100 + 5 * 10);
      expect(p1.hi).toBeGreaterThan(100 + 5 * 10);
    }
  });
  it('recta exacta: s = 0, t infinito, intervalo degenerado', () => {
    const r = tendenciaLineal(Array.from({ length: 8 }, (_, i) => 10 + 2 * i), 1);
    expect(r.emite && r.datos.usaTendencia && r.datos.puntos[0]!.lo).toBeCloseTo(26, 9);
  });
  it('ruido sin pendiente significativa: sin tendencia clara y no se proyecta con ella', () => {
    const r = tendenciaLineal([100, 140, 90, 130, 95, 135, 100, 125, 92, 138], 4);
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.usaTendencia).toBe(false);
      expect(r.datos.puntos).toEqual([]);
      expect(r.datos.motivo).toContain('sin tendencia clara');
    }
  });
  it('serie constante: t = 0', () => {
    const r = tendenciaLineal(constante(9, 7), 2);
    expect(r.emite && r.datos.t).toBe(0);
  });
  it('tabla t de Student: valores de referencia', () => {
    expect(t90(1)).toBeCloseTo(3.078, 3);
    expect(t90(8)).toBeCloseTo(1.397, 3);
    expect(t90(30)).toBeCloseTo(1.31, 3);
    expect(t90(500)).toBeCloseTo(1.282, 3);
    expect(t90(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('estacionalidad', () => {
  it('menos de 12 meses: no se emite', () => {
    const r = estacionalidad(constante(11, 100), 1);
    expect(r.emite).toBe(false);
    if (!r.emite) expect(r.razon).toContain('faltan 1 meses');
  });
  it('12 meses: solo descriptiva (Observado) y no se aplica', () => {
    const r = estacionalidad(constante(12, 100), 1);
    expect(r.emite && r.clase).toBe('Observado');
    expect(r.emite && r.datos.aplicable).toBe(false);
    expect(r.emite && r.datos.indiceBp[3]).toBe(10_000);
  });
  it('24 meses: se aplica; el mes pico tiene indice mayor a 1', () => {
    const serie = Array.from({ length: 24 }, (_, i) => (i % 12 === 11 ? 200 : 100));
    const r = estacionalidad(serie, 1);
    expect(r.emite && r.clase).toBe('Estimado');
    expect(r.emite && r.datos.aplicable).toBe(true);
    expect(r.emite && r.datos.indiceBp[12]!).toBeGreaterThan(10_000);
  });
});

describe('punto de reorden y cobertura', () => {
  const lt = { dias: 7, reposiciones: 5, declarado: false };
  const entrada = (ventas: number[], existencia: number, extra: Partial<Parameters<typeof puntoReorden>[0]> = {}) => ({ ventasSemanales: ventas, existencia, enTransito: 0, leadTime: lt, piezasPorCaja: 150, ...extra });
  it('respuesta conocida: 350 por semana = 50 por dia, sin variacion', () => {
    const r = puntoReorden(entrada(constante(8, 350), 312));
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.demandaDiaria).toBeCloseTo(50, 9);
      expect(r.datos.stockSeguridad).toBeCloseTo(0, 9);
      expect(r.datos.puntoReorden).toBeCloseTo(350, 9);
      expect(r.datos.coberturaDias).toBeCloseTo(6.24, 2);
      expect(r.datos.debeReponer).toBe(true);
      // d * (LT + R) = 700; menos 312 = 388; a cajas de 150 = 450
      expect(r.datos.pedir).toBe(450);
    }
  });
  it('minimos: 4 semanas, 3 con venta, 40 piezas y lead time con 3 reposiciones o declarado', () => {
    expect(puntoReorden(entrada([100, 100, 100], 10)).emite).toBe(false);
    expect(puntoReorden(entrada([100, 100, 0, 0], 10)).emite).toBe(false);
    expect(puntoReorden(entrada([5, 5, 5, 5], 10)).emite).toBe(false);
    expect(puntoReorden(entrada(constante(8, 100), 10, { leadTime: { dias: 7, reposiciones: 2, declarado: false } })).emite).toBe(false);
    expect(puntoReorden(entrada(constante(8, 100), 10, { leadTime: { dias: 7, reposiciones: 0, declarado: true } })).emite).toBe(true);
    const sin = puntoReorden(entrada([], 10));
    expect(sin.emite).toBe(false);
    if (!sin.emite) expect(sin.faltan).toBe(4);
  });
  it('sin demanda reciente la cobertura es indeterminada (null), no infinita', () => {
    const r = puntoReorden(entrada([50, 50, 50, 0, 0, 0, 0, 0], 100));
    expect(r.emite).toBe(true);
    if (r.emite) expect(r.datos.coberturaDias).not.toBeNull();
    const cero = puntoReorden(entrada(constante(8, 100), 100));
    expect(cero.emite && cero.datos.coberturaLo).not.toBeNull();
  });
  it('propiedad: pedir es multiplo de caja y no negativo; con existencia enorme no hay pedido', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 10, max: 600 }), { minLength: 8, maxLength: 8 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 800 }), (v, ex, tr) => {
        const r = puntoReorden(entrada(v, ex, { enTransito: tr }));
        expect(r.emite).toBe(true);
        if (r.emite) {
          expect(r.datos.pedir).toBeGreaterThanOrEqual(0);
          expect(r.datos.pedir % 150).toBe(0);
          // Con demanda minima cero la cobertura maxima es indeterminada (null), no un numero.
          if (r.datos.coberturaHi !== null) expect(r.datos.coberturaLo!).toBeLessThanOrEqual(r.datos.coberturaHi + 1e-9);
        }
      }),
      { numRuns: 200 },
    );
    const mucho = puntoReorden(entrada(constante(8, 100), 100_000));
    expect(mucho.emite && mucho.datos.pedir).toBe(0);
    expect(mucho.emite && mucho.datos.debeReponer).toBe(false);
  });
});

describe('proximo pedido del cliente', () => {
  it('menos de 4 pedidos: no se emite', () => {
    const r = proximoPedido(['2026-10-01', '2026-10-15', '2026-10-29']);
    expect(r.emite).toBe(false);
    if (!r.emite) expect(r.razon).toContain('pedidos');
  });
  it('ultimo pedido mas mediana de intervalos, con cuartiles', () => {
    const r = proximoPedido(['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-12']);
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.fecha).toBe('2026-11-26');
      expect(r.datos.medianaIntervalo).toBe(14);
      expect(r.datos.desde <= r.datos.fecha && r.datos.fecha <= r.datos.hasta).toBe(true);
    }
  });
  it('diasEntre valida la fecha', () => {
    expect(diasEntre('2026-11-01', '2026-11-08')).toBe(7);
    expect(() => diasEntre('2026-13', '2026-11-08')).toThrow(RangeError);
  });
});

describe('flujo de caja a 4 semanas', () => {
  const flujo = (sobre: Partial<FlujoInsumo> = {}): FlujoInsumo => ({
    saldoInicialCent: 10_000_000n,
    cobrosSemanalesCent: constante(8, 5_000_000).map(BigInt),
    cobrosPrometidosCent: [0n, 0n, 0n, 0n],
    pagosProveedorCent: [4_000_000n, 4_000_000n, 4_000_000n, 4_000_000n],
    omarCent: [0n, 0n, 0n, 0n],
    gastosCent: [100_000n, 100_000n, 100_000n, 100_000n],
    ...sobre,
  });
  it('sin 8 semanas de cobros ni cadencia declarada no se emite', () => {
    const r = flujoCaja(flujo({ cobrosSemanalesCent: [1n, 2n, 3n] }));
    expect(r.emite).toBe(false);
    if (!r.emite) expect(r.faltan).toBe(5);
  });
  it('saldo_t = saldo_{t-1} + cobros - proveedores - omar - gastos (respuesta conocida)', () => {
    const r = flujoCaja(flujo());
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.datos.semanas.map((s) => s.saldoCent)).toEqual([10_900_000n, 11_800_000n, 12_700_000n, 13_600_000n]);
      expect(r.clase).toBe('Estimado');
      expect(r.datos.origenCobros).toBe('historia');
    }
  });
  it('lo prometido con fecha es exacto y manda sobre el estimado', () => {
    const r = flujoCaja(flujo({ cobrosPrometidosCent: [9_000_000n, 0n, 0n, 0n] }));
    expect(r.emite && r.datos.semanas[0]!.cobrosCent).toBe(9_000_000n);
    expect(r.emite && r.datos.semanas[0]!.clase).toBe('Observado');
  });
  it('cadencia declarada con rango se rotula Declarado, no observado', () => {
    const r = flujoCaja(flujo({ cobrosSemanalesCent: [], cadenciaDeclaradaCent: { semanaCent: 5_000_000n, rangoPct: 20 } }));
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.clase).toBe('Declarado');
      expect(r.leyenda).toContain('Declarado, no observado');
      expect(r.datos.semanas[0]!.saldoLoCent).toBeLessThan(r.datos.semanas[0]!.saldoHiCent);
      expect(r.datos.semanas[0]!.clase).toBe('Declarado');
    }
  });
  it('el saldo minimo es el del peor caso y la cobertura del viernes sigue la formula', () => {
    const r = flujoCaja(flujo({ cobrosSemanalesCent: [1_000_000n, 9_000_000n, 1_000_000n, 9_000_000n, 1_000_000n, 9_000_000n, 1_000_000n, 9_000_000n] }));
    expect(r.emite && r.datos.saldoMinimoCent <= r.datos.semanas[0]!.saldoCent).toBe(true);
    expect(coberturaViernes(30_000_000n, 24_950_000n, 42_266_800n)).toBe(1300n);
    expect(coberturaViernes(1n, 1n, 0n)).toBeNull();
  });
  it('propiedad: el saldo final es el inicial mas los flujos, para cualquier serie', () => {
    fc.assert(
      fc.property(fc.array(fc.bigInt({ min: 0n, max: 90_000_000n }), { minLength: 8, maxLength: 10 }), fc.bigInt({ min: 0n, max: 90_000_000n }), (cobros, ini) => {
        const f = flujo({ cobrosSemanalesCent: cobros, saldoInicialCent: ini });
        const r = flujoCaja(f);
        expect(r.emite).toBe(true);
        if (r.emite) {
          const ult = r.datos.semanas[3]!;
          const suma = r.datos.semanas.reduce((a, s) => a + s.cobrosCent - s.pagosProvCent - s.omarCent - s.gastosCent, 0n);
          expect(ult.saldoCent).toBe(ini + suma);
          expect(ult.saldoLoCent <= ult.saldoCent && ult.saldoCent <= ult.saldoHiCent).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('fin de mes de Omar', () => {
  it('menos de 14 dias de historia no se emite', () => {
    const r = finDeMesOmar({ saldoCent: 0n, piezas28: 100, diasHistoria: 13, diasRestantes: 10, enTransito: 0, sigmaDiaria: 1 });
    expect(r.emite).toBe(false);
    if (!r.emite) expect(r.razon).toContain('faltan 1 días');
  });
  it('saldo mas transito x $2 mas lo que falte por surtir', () => {
    const r = finDeMesOmar({ saldoCent: 10_000n, piezas28: 280, diasHistoria: 28, diasRestantes: 10, enTransito: 20, sigmaDiaria: 0 });
    expect(r.emite).toBe(true);
    if (r.emite) {
      // d = 10 pz/dia; futuras = 100 - 20 = 80 -> 80 x $2; transito 20 x $2
      expect(r.datos.centralCent).toBe(10_000n + 20n * 200n + 80n * 200n);
      expect(r.datos.loCent).toBe(r.datos.hiCent - 0n);
    }
  });
});

describe('escenarios de sensibilidad (sin probabilidad)', () => {
  it('costo: delta = -dc x piezas, margen nuevo y lineas bajo cero', () => {
    const r = escenarioCosto({ piezasProyectadas: 2300, utilidadProyectadaCent: 4_042_200n, ventasProyectadasCent: 46_390_000n, deltaCostoCent: 500n, lineas: [{ modelo: 'A', contribPorPiezaCent: 300n }, { modelo: 'B', contribPorPiezaCent: 900n }] });
    expect(r.emite).toBe(true);
    if (r.emite) {
      expect(r.clase).toBe('Escenario');
      expect(r.leyenda).toContain('sin probabilidad');
      expect(r.datos.impactoCent).toBe(-1_150_000n);
      expect(r.datos.lineasBajoCero).toEqual(['A']);
      expect(r.datos.utilidadNuevaCent).toBe(4_042_200n - 1_150_000n);
    }
  });
  it('sin base valida no se emite', () => {
    expect(escenarioCosto({ piezasProyectadas: 0, utilidadProyectadaCent: 1n, ventasProyectadasCent: 1n, deltaCostoCent: 1n, lineas: [] }).emite).toBe(false);
    expect(escenarioMezcla({ piezasOrigenPeriodo: 0, puntosPct: 10, uOrigenCent: 1n, uDestinoCent: 1n }).emite).toBe(false);
    expect(escenarioConcentracion([]).emite).toBe(false);
    expect(escenarioRetrasoCobro({ semanas: [], saldoMinimoCent: 0n, origenCobros: 'historia' }, []).emite).toBe(false);
  });
  it('mezcla: piezas movidas por la diferencia de contribucion', () => {
    const r = escenarioMezcla({ piezasOrigenPeriodo: 450, puntosPct: 10, uOrigenCent: 2000n, uDestinoCent: 1000n });
    expect(r.emite && r.datos).toEqual({ piezasMovidas: 45, impactoCent: -45_000n });
  });
  it('concentracion: con 13 semanas usa la mediana; con menos usa la ultima y lo rotula', () => {
    const trece = Array.from({ length: 13 }, (_, i) => BigInt(100_000 + i * 1000));
    const a = escenarioConcentracion(trece);
    expect(a.emite && a.datos.baseRotulada).toBe(false);
    expect(a.emite && a.datos.impactoCent).toBe(-106_000n * 4n);
    const b = escenarioConcentracion([50_000n, 70_000n]);
    expect(b.emite && b.datos.baseRotulada).toBe(true);
    expect(b.emite && b.datos.impactoCent).toBe(-280_000n);
  });
  it('retraso de cobro: los deudores quitan saldo dos semanas', () => {
    const f = flujoCaja({ saldoInicialCent: 0n, cobrosSemanalesCent: constante(8, 5_000_000).map(BigInt), cobrosPrometidosCent: [0n, 0n, 0n, 0n], pagosProveedorCent: [0n, 0n, 0n, 0n], omarCent: [0n, 0n, 0n, 0n], gastosCent: [0n, 0n, 0n, 0n] });
    expect(f.emite).toBe(true);
    if (f.emite) {
      const r = escenarioRetrasoCobro(f.datos, [{ semana: 1, montoCent: 3_000_000n }]);
      expect(r.emite && r.datos.efectoCent).toBeLessThan(0n);
    }
  });
  it('noSeEstima arma la frase fija', () => {
    expect(noSeEstima(3, 8).razon).toBe('No se estima: faltan 3 semanas (mínimo 8)');
    expect(noSeEstima(2, 12, 'meses').razon).toContain('meses');
  });
});
