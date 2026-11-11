import { describe, expect, it } from 'vitest';
import { desglosarSocio, diferenciaIdentidadSocios } from '@/dominio/operacion/desglose_socio';
import type { EstadoCuentaSocio, MovimientoEstadoSocio } from '@/dominio/operacion/tipos';

const mov = {} as MovimientoEstadoSocio;
function estado(socio: 'Angelo' | 'Javier', p: Partial<EstadoCuentaSocio>): EstadoCuentaSocio {
  return {
    socio, neto_cent: 0n, aportaciones_capital_cent: 0n, gastos_pagados_cent: 0n, reembolsos_recibidos_cent: 0n, devoluciones_recibidas_cent: 0n, retiros_cent: 0n,
    utilidad_asignada_cent: 0n, fondos_cent: 0n, faltantes_cent: 0n, debe_cent: 0n, reembolso_pendiente_cent: 0n, aportacion_pendiente_cent: 0n, dias_fondos: null, movimientos: [mov], ...p,
  };
}
const linea = (e: EstadoCuentaSocio, id: string) => desglosarSocio(e).grupos.flatMap((g) => g.lineas).find((l) => l.id === id)!;

// Ejemplo de la adenda 21: utilidad antes de gastos 20,000; Javier pago 2,221 y Angelo 500; utilidad neta 17,279; 8,639.50 a cada uno (el centavo sobrante, a Javier).
// Utilidad neta 17,279.00 = 1,727,900 cent: 863,950 para cada uno, sin sobrante que redondear.
describe('desglose de socio: gasto pagado por socio (adenda 21)', () => {
  const utilidadNeta = 2_000_000n - 222_100n - 50_000n;
  const mitad = utilidadNeta / 2n;
  // Despues de reembolsar: el reembolso liquida la deuda y la posicion queda solo en la utilidad.
  const javier = estado('Javier', { gastos_pagados_cent: 222_100n, reembolsos_recibidos_cent: 222_100n, utilidad_asignada_cent: mitad, neto_cent: mitad });
  const angelo = estado('Angelo', { gastos_pagados_cent: 50_000n, reembolsos_recibidos_cent: 50_000n, utilidad_asignada_cent: mitad, neto_cent: mitad });

  it('la utilidad neta ya descuenta los gastos una sola vez y se reparte 50/50', () => {
    expect(utilidadNeta).toBe(1_727_900n);
    expect(linea(javier, 'utilidad').cent).toBe(863_950n);
    expect(linea(angelo, 'utilidad').cent).toBe(863_950n);
    expect(javier.utilidad_asignada_cent + angelo.utilidad_asignada_cent).toBe(utilidadNeta);
  });

  it('el reembolso solo liquida la deuda: el pendiente queda en cero y el neto no resta el gasto otra vez', () => {
    for (const e of [javier, angelo]) {
      const d = desglosarSocio(e);
      expect(d.cuadra).toBe(true);
      expect(d.residuo_cent).toBe(0n);
      expect(linea(e, 'neto').cent).toBe(e.utilidad_asignada_cent);
    }
    expect(linea(javier, 'gastos').cent).toBe(222_100n);
    expect(linea(javier, 'reembolsos').cent).toBe(222_100n);
  });

  it('antes del reembolso la sociedad le debe el gasto al socio (cuenta por pagar) y el neto lo refleja una vez', () => {
    const pendiente = estado('Javier', { gastos_pagados_cent: 222_100n, reembolso_pendiente_cent: 222_100n, utilidad_asignada_cent: mitad, neto_cent: mitad + 222_100n });
    expect(desglosarSocio(pendiente).cuadra).toBe(true);
    expect(linea(pendiente, 'reembolso_pendiente').cent).toBe(222_100n);
  });

  it('identidad: la suma de saldos de los socios es igual a los activos netos de la sociedad', () => {
    expect(diferenciaIdentidadSocios([javier, angelo], utilidadNeta)).toBe(0n);
    expect(diferenciaIdentidadSocios([javier, angelo], utilidadNeta + 1n)).toBe(-1n);
  });

  it('un neto que no se explica por sus partes se marca como no cuadra', () => {
    const roto = estado('Javier', { utilidad_asignada_cent: 100n, neto_cent: 150n });
    const d = desglosarSocio(roto);
    expect(d.cuadra).toBe(false);
    expect(d.residuo_cent).toBe(50n);
    expect(linea(roto, 'neto').comprobacion).toBe('no_cuadra');
  });

  it("'Sin dato' donde no hay movimientos, y cero real donde si los hay", () => {
    const vacio = { ...estado('Angelo', {}), movimientos: [] };
    expect(linea(vacio, 'retiros').cent).toBeNull();
    expect(linea(vacio, 'neto').cent).toBe(0n);
    expect(linea(angelo, 'retiros').cent).toBe(0n);
  });

  it('las deudas y faltantes restan de la posicion neta', () => {
    const e = estado('Javier', { utilidad_asignada_cent: 1_000n, faltantes_cent: 300n, debe_cent: 300n, neto_cent: 700n });
    expect(desglosarSocio(e).cuadra).toBe(true);
  });
});
