// PDF del acta con sello y estado de cuenta personal: bytes validos y estables (mismos datos, misma huella).
import { describe, expect, it } from 'vitest';
import type { Cascada, CierreReparto } from '@/dominio/operacion/tipos';
import type { HistorialSocio, SelloActa } from '@/dominio/historial/tipos';
import { pdfActaCorte } from '@/infra/pdf/acta';
import { pdfHistorialSocio } from '@/infra/pdf/historial';
import { huella } from '@/infra/pdf/nota';
import { cascadaCalcular } from '@/dominio/dinero/reparto';

function acta(): CierreReparto {
  const r = cascadaCalcular({
    utilidad: 1_727_900n, arrastre: 0n, caja: 2_000_000n, comprometido: 0n, reembolsos: { Angelo: 50_000n, Javier: 222_100n }, aportaciones: { Angelo: 0n, Javier: 0n },
    poder: { Angelo: 0n, Javier: 0n }, deuda: { Angelo: 0n, Javier: 0n }, anticipos: { Angelo: 0n, Javier: 0n }, ppm: { Angelo: 500_000n, Javier: 500_000n }, rotor: 0,
  });
  const socio = (k: 'Angelo' | 'Javier') => ({
    reembolso_pendiente_cent: r.porSocio[k]!.reembolsoPendiente, aportacion_pendiente_cent: 0n, paga_reembolso_cent: r.porSocio[k]!.pagaReembolso, utilidad_cent: r.porSocio[k]!.utilidad,
    anticipo_cent: 0n, asignado_cent: r.porSocio[k]!.asignado, tiene_en_poder_cent: 0n, debe_cent: 0n, resultado_cent: r.porSocio[k]!.resultado, sigue_pendiente_cent: 0n,
  });
  const snapshot = {
    periodo_ini: '2026-10-01', periodo_fin: '2026-10-31', utilidad_cent: r.utilidad, perdida_cent: 0n, utilidad_provisional: false, arrastre_ini_cent: 0n, arrastre_fin_cent: r.arrastreFin,
    utilidad_acumulada_cent: r.utilidad, efectivo: { en_poder_cent: 0n, caja_cent: 2_000_000n, total_cent: r.efectivoTotal, comprometido_cent: 0n, disponible_cent: r.disponible },
    reembolsos: { pendiente_cent: 272_100n, pagado_cent: r.pagadoReembolsos }, aportaciones: { pendiente_cent: 0n, pagado_cent: 0n }, repartible_cent: r.repartible, remanente_cent: r.remanente,
    limitado_por_efectivo: false, por_socio: { Angelo: socio('Angelo'), Javier: socio('Javier') }, suma_asignada_cent: r.sumaAsignada, suma_resultados_cent: r.sumaResultados, identidad_cuadra: true,
    identidad: { via1_cent: r.identidad.via1, via2_cent: r.identidad.via2, efectivo_repartido_cent: r.identidad.efectivoRepartido, deuda_no_efectivo_cent: 0n, cuadra: true }, liquidar: null,
    utilidad_detalle: { utilidad_pedidos_cent: 0n, pedidos: 0, utilidad_tomas_cent: 0n, gastos_cent: 0n, provisional: false, utilidad_cent: r.utilidad },
  } as unknown as Cascada;
  return {
    id: 1, folio: 'CR-0001', tipo: 'periodo', corrige_a: null, corregida: false, periodo_ini: '2026-10-01', periodo_fin: '2026-10-31', utilidad_cent: r.utilidad, utilidad_provisional: false,
    efectivo_caja_cent: 2_000_000n, nota: null, snapshot, decisiones: { Angelo: { retira: 863_950n, reinvierte: 0n }, Javier: { retira: 0n, reinvierte: 863_950n } },
    arrastre_ini_cent: 0n, arrastre_fin_cent: 0n, creado_at: '2026-11-01T18:00:00.000Z', propuesto_por: 'Angelo',
    firmas: [{ socio: 'Angelo', firmado_at: '2026-11-01T18:05:00.000Z' }, { socio: 'Javier', firmado_at: '2026-11-01T19:00:00.000Z' }], estado: 'cerrado', yo_firme: true,
  };
}
const sello = (): SelloActa => ({
  huella: 'ab'.repeat(32), sellado_at: '2026-11-02T16:00:01Z',
  contenido: {
    periodo_ini: '2026-10-01', periodo_fin: '2026-10-31', utilidad_cent: 1_200_000n, decisiones: {}, valuacion_cent: 3_000_000n, deudas_cent: 500_000n, capital_contable_cent: 2_500_000n,
    valor_participacion_cent: { Angelo: 1_250_000n, Javier: 1_250_000n },
    por_socio: {
      Angelo: { invertido_cent: 200_000n, retirado_cent: 0n, por_distribuir_cent: 400_000n, fondos_en_poder_cent: 0n, compensaciones_cent: 0n, cuenta_cent: 0n, neto_cent: 400_000n },
      Javier: { invertido_cent: 600_000n, retirado_cent: 0n, por_distribuir_cent: 0n, fondos_en_poder_cent: 0n, compensaciones_cent: 0n, cuenta_cent: 0n, neto_cent: 0n },
    },
  },
});

describe('PDF del acta con sello', () => {
  it('es un PDF y es estable', async () => {
    const a = await pdfActaCorte(acta(), sello());
    const b = await pdfActaCorte(acta(), sello());
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe('%PDF-');
    expect(huella(a)).toBe(huella(b));
  });
  it('el sello cambia el documento', async () => {
    expect(huella(await pdfActaCorte(acta(), sello()))).not.toBe(huella(await pdfActaCorte(acta())));
  });
});

describe('PDF del estado de cuenta personal', () => {
  const h = (): HistorialSocio => ({
    socio: 'Angelo', otro: 'Javier', hoy: '2026-11-12', hasta: '2026-11-12', con_historial: true,
    cabecera: {
      aportaciones_cent: 0n, reinversion_cent: 200_000n, invertido_cent: 200_000n, invertido_ambos_cent: 800_000n, retirado_utilidad_cent: 0n, retirado_capital_cent: 0n, retirado_cent: 0n,
      utilidad_asignada_cent: 600_000n, utilidad_por_distribuir_cent: 400_000n, capital_contable_cent: null, valor_cent: null, valor_bajo_cent: null, valor_alto_cent: null, por_cobrar_clientes_cent: null,
      capital_cuenta_cent: 400_000n, neto_cent: 400_000n, cuenta_cent: 0n, comprobaciones: { invertido: true, retirado: true, utilidad: true, valor: null, cuenta: true }, reembolso_pendiente_cent: 0n, fondos_cent: 0n, efectivo_total_cent: 0n, efectivo_disponible_cent: 0n, primera_fecha: '2026-10-01', meses_activo: 2,
    },
    flujos: [], actas: [], totales: null, dias: [], semanas: [], meses: [], por_cliente: [], por_modelo: [],
  });
  it('genera PDF con Sin dato y es estable', async () => {
    const a = await pdfHistorialSocio(h());
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe('%PDF-');
    expect(huella(a)).toBe(huella(await pdfHistorialSocio(h())));
  });
});
