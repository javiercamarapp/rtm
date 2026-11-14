import { describe, expect, it } from 'vitest';
import { alertaRetiros, desgloseDiferencia, fraseIgualar, indicacionesSocio, notaDiferencias, puntosSerie, tarjetaValuacion, textoFaltan, type CuentaSociosValuacion, type FilaSocioValuacion, type IgualacionValuacion } from '@/dominio/socios/valuacion';
import { formatearMoneda } from '@/dominio/formato';

const f = (c: bigint) => formatearMoneda(c);
const fila = (socio: 'Angelo' | 'Javier', cap: bigint, util: bigint, ret: bigint, fondos: bigint): FilaSocioValuacion => ({
  socio, capital_aportado_cent: cap, utilidades_acumuladas_cent: util, retirado_cent: ret, retirado_utilidad_cent: ret, devoluciones_capital_cent: 0n, fondos_en_poder_cent: fondos,
  subtotal_cent: cap + util - ret, valuacion_cent: cap + util - ret - fondos, utilidad_generada_cent: util, reinvertida_acta_cent: 0n, aportado_cent: cap, aportacion_neta_cent: cap - fondos,
  diferencia_a_igualar_cent: 0n, participacion_bp: 5000,
});

// Replica en memoria lo que entrega la base (operacion.cuenta_socios_valuacion, bloque igualacion): el dominio solo redacta, no calcula.
function igualacionDe(socios: FilaSocioValuacion[]): IgualacionValuacion {
  const [a, j] = [socios.find((x) => x.socio === 'Angelo')!, socios.find((x) => x.socio === 'Javier')!];
  const x = a.valuacion_cent > j.valuacion_cent ? a.valuacion_cent - j.valuacion_cent : j.valuacion_cent - a.valuacion_cent;
  const mayor = a.valuacion_cent > j.valuacion_cent ? a : j;
  const menor = mayor === a ? j : a;
  const vpA = a.valuacion_cent + a.fondos_en_poder_cent, vpJ = j.valuacion_cent + j.fondos_en_poder_cent;
  const mx = (p: bigint, q: bigint) => (p > q ? p - q : 0n);
  const comp = [
    { id: 'capital' as const, nombre: '', menor_cent: menor.capital_aportado_cent, mayor_cent: mayor.capital_aportado_cent, monto_cent: mayor.capital_aportado_cent - menor.capital_aportado_cent },
    { id: 'fondos' as const, nombre: '', menor_cent: menor.fondos_en_poder_cent, mayor_cent: mayor.fondos_en_poder_cent, monto_cent: menor.fondos_en_poder_cent - mayor.fondos_en_poder_cent },
    { id: 'retiros' as const, nombre: '', menor_cent: menor.retirado_cent, mayor_cent: mayor.retirado_cent, monto_cent: menor.retirado_cent - mayor.retirado_cent },
    { id: 'utilidades' as const, nombre: '', menor_cent: menor.utilidades_acumuladas_cent, mayor_cent: mayor.utilidades_acumuladas_cent, monto_cent: mayor.utilidades_acumuladas_cent - menor.utilidades_acumuladas_cent },
  ];
  return {
    igualados: x === 0n, faltan_cent: x, mayor: x === 0n ? null : mayor.socio, menor: x === 0n ? null : menor.socio, componentes: comp, suma_componentes_cent: comp.reduce((t, k) => t + k.monto_cent, 0n),
    por_socio: { Angelo: { entregar_cent: a.fondos_en_poder_cent, valuacion_tras_entregar_cent: vpA, aportar_cent: mx(vpJ, vpA) }, Javier: { entregar_cent: j.fondos_en_poder_cent, valuacion_tras_entregar_cent: vpJ, aportar_cent: mx(vpA, vpJ) } },
    diferencia_libro_cent: x, coincide_con_libro: true, regla: '',
  };
}
// Cifras del dueno: Javier 118,161.91 + 36,670.39; Angelo 105,715.00 + 36,670.39 - 35,475.00; retiros 0.
function cuenta(over: Partial<CuentaSociosValuacion['comparacion']> = {}, socios = [fila('Angelo', 10571500n, 3667039n, 0n, 3547500n), fila('Javier', 11816191n, 3667039n, 0n, 0n)]): CuentaSociosValuacion {
  const va = socios[0]!.valuacion_cent, vj = socios[1]!.valuacion_cent;
  const x = va > vj ? va - vj : vj - va;
  return {
    hasta: '2026-11-13', hoy: '2026-11-13', primera_fecha: '2026-10-15', hay_movimientos: true, socios,
    total: { capital_aportado_cent: 22387691n, utilidades_acumuladas_cent: 7334078n, retirado_cent: 0n, fondos_en_poder_cent: 3547500n, subtotal_cent: 29721769n, valuacion_cent: 26174269n },
    igualacion: igualacionDe(socios),
    comparacion: { mayor: x === 0n ? null : va > vj ? 'Angelo' : 'Javier', menor: x === 0n ? null : va > vj ? 'Javier' : 'Angelo', diferencia_valuacion_cent: x, diferencia_aportacion_cent: 4792191n, igualados: x === 0n,
      le_toca_aportar: x === 0n ? null : va > vj ? 'Javier' : 'Angelo', aportar_para_igualar_cent: x, turno_aportacion_neta: 'Angelo', retiros_desiguales: false, diferencia_retiros_cent: 0n, retiro_mas: null, ...over },
    balance: { total_activo_cent: 64590578n, total_pasivo_cent: 34868809n, capital_contable_cent: 29721769n, cuadra: true }, identidades: [], comprobaciones_libro: [],
    serie: [{ mes: '2026-10', fin: '2026-10-31', parcial: false, socios: [{ socio: 'Javier', valuacion_cent: 11816191n, capital_aportado_cent: 11816191n, retirado_cent: 0n, utilidades_acumuladas_cent: 0n, fondos_en_poder_cent: 0n }] }],
    proveedores: { detalle: [], se_debe_cent: 0n, a_favor_cent: 0n, pedidos_socio_a_costo_cent: null, deuda_empresa_cent: null, nota: '' }, definicion: '',
  };
}

describe('tarjeta TU VALUACION del Inicio', () => {
  it('Javier ve su valuacion y que tiene mas que Angelo', () => {
    const t = tarjetaValuacion(cuenta(), 'Javier', f)!;
    expect(t.valorCent).toBe(15483230n);
    expect(t.valorTexto).toBe('$154,832.30');
    expect(t.estado).toBe('mas');
    expect(t.comparacion).toBe('Tienes $47,921.91 más que Angelo');
    expect(t.accion).toBe('Angelo debe igualar: faltan $47,921.91 (entregar $35,475.00 + aportar $12,446.91)');
    expect(t.faltan).toBe('Faltan $47,921.91 para estar idénticos');
  });
  it('Angelo ve su valuacion, que tiene menos y le toca aportar', () => {
    const t = tarjetaValuacion(cuenta(), 'Angelo', f)!;
    expect(t.valorCent).toBe(10691039n);
    expect(t.valorTexto).toBe('$106,910.39');
    expect(t.estado).toBe('menos');
    expect(t.comparacion).toBe('Tienes $47,921.91 menos que Javier');
    expect(t.accion).toBe('Para igualar: entrega a la sociedad los $35,475.00 que tienes cobrados y aporta $12,446.91 con el siguiente pago');
    expect(t.indicaciones).toHaveLength(1);
  });
  it('igualados: sin accion', () => {
    const t = tarjetaValuacion(cuenta({}, [fila('Angelo', 10000n, 500n, 0n, 0n), fila('Javier', 10000n, 500n, 0n, 0n)]), 'Angelo', f)!;
    expect(t.estado).toBe('igual');
    expect(t.comparacion).toBe('Estás igualado con Javier');
    expect(t.accion).toBeNull();
    expect(t.faltan).toBe('Igualados');
  });
  it('sin la fila del socio no hay tarjeta', () => {
    expect(tarjetaValuacion({ ...cuenta(), socios: [] }, 'Javier', f)).toBeNull();
  });
});

describe('frases de comparacion y retiros', () => {
  it('frase: quien tiene mas y a quien le toca aportar', () => {
    expect(fraseIgualar(cuenta(), f)).toEqual({ texto: 'Javier tiene $47,921.91 más que Angelo. Le toca aportar $47,921.91 a Angelo para igualar valuaciones.', tono: 'atencion' });
  });
  it('retiros iguales: sin alerta', () => { expect(alertaRetiros(cuenta(), f)).toBeNull(); });
  it('retiro desigual: alerta con la diferencia a igualar', () => {
    const c = cuenta({ retiros_desiguales: true, diferencia_retiros_cent: 100000n, retiro_mas: 'Angelo' });
    expect(alertaRetiros(c, f)).toBe('Retiro desigual: Angelo se ha pagado $1,000.00 más que Javier. Para igualar retiros, Javier se paga esa diferencia.');
  });
  it('X y Y iguales: sin nota; distintos: la explica', () => {
    expect(notaDiferencias(cuenta(), f)).toBeNull();
    const c = cuenta({ diferencia_aportacion_cent: 4792192n });
    expect(notaDiferencias(c, f)).toContain('centavo suelto');
    expect(notaDiferencias(cuenta({ diferencia_aportacion_cent: 4892191n, retiros_desiguales: true }), f)).toContain('retiros desiguales');
  });
  it('serie: puntos de un socio', () => {
    expect(puntosSerie(cuenta(), 'Javier')).toEqual([{ mes: '2026-10', valor: 11816191 }]);
    expect(puntosSerie(cuenta(), 'Angelo')).toEqual([]);
  });
});

describe('desglose de la diferencia y pasos para igualar (cifras del dueno)', () => {
  it('47,921.91 = 12,446.91 (aporto menos) + 35,475.00 (fondos cobrados en su cuenta)', () => {
    const d = desgloseDiferencia(cuenta(), f);
    expect(d.map((x) => [x.id, x.montoCent])).toEqual([['capital', 1244691n], ['fondos', 3547500n]]);
    expect(d[0]!.texto).toBe('Angelo aportó menos capital ($105,715.00 contra $118,161.91)');
    expect(d[1]!.texto).toContain('Fondos de la sociedad cobrados en la cuenta de Angelo');
    expect(d.reduce((t, x) => t + x.montoCent, 0n)).toBe(4792191n);
    expect(textoFaltan(cuenta(), f)).toBe('Faltan $47,921.91 para estar idénticos');
  });
  it('secuencia: al entregar 35,475.00 Angelo sube a 142,385.39 y solo faltan 12,446.91', () => {
    const c = cuenta();
    expect(c.igualacion.por_socio.Angelo).toEqual({ entregar_cent: 3547500n, valuacion_tras_entregar_cent: 14238539n, aportar_cent: 1244691n });
    expect(indicacionesSocio(c, 'Angelo', f)).toEqual(['Para igualar: entrega a la sociedad los $35,475.00 que tienes cobrados y aporta $12,446.91 con el siguiente pago']);
    expect(indicacionesSocio(c, 'Javier', f)).toEqual(['Angelo debe igualar: faltan $47,921.91 (entregar $35,475.00 + aportar $12,446.91)']);
  });
  it('ya entrego los fondos: solo falta aportar', () => {
    const c = cuenta({}, [fila('Angelo', 10571500n, 3667039n, 0n, 0n), fila('Javier', 11816191n, 3667039n, 0n, 0n)]);
    expect(indicacionesSocio(c, 'Angelo', f)).toEqual(['Para igualar: aporta $12,446.91 con el siguiente pago']);
    expect(indicacionesSocio(c, 'Javier', f)).toEqual(['Angelo debe igualar: faltan $12,446.91 (aportar $12,446.91)']);
  });
  it('retiros desiguales: aparece como renglon y la suma sigue exacta', () => {
    const c = cuenta({}, [fila('Angelo', 11816191n, 3667039n, 400000n, 0n), fila('Javier', 11816191n, 3667039n, 300000n, 0n)]);
    const d = desgloseDiferencia(c, f);
    expect(d.map((x) => [x.id, x.montoCent])).toEqual([['retiros', 100000n]]);
    expect(d[0]!.texto).toBe('Angelo se ha pagado más en retiros ($4,000.00 contra $3,000.00)');
    expect(indicacionesSocio(c, 'Angelo', f)).toEqual(['Para igualar: aporta $1,000.00 con el siguiente pago']);
  });
  it('igualados: sin desglose ni indicaciones', () => {
    const c = cuenta({}, [fila('Angelo', 10000n, 500n, 0n, 0n), fila('Javier', 10000n, 500n, 0n, 0n)]);
    expect(desgloseDiferencia(c, f)).toEqual([]);
    expect(indicacionesSocio(c, 'Javier', f)).toEqual([]);
    expect(textoFaltan(c, f)).toBe('Igualados');
  });
});
