// PDF del acta de corte: huella estable y las cifras del ejemplo del dueno (utilidad 17,279; 8,639.50 a cada uno; reembolsos 500 y 2,221).
import { describe, expect, it } from 'vitest';
import { cascadaCalcular } from '@/dominio/dinero/reparto';
import type { Cascada, CierreReparto } from '@/dominio/operacion/tipos';
import { huella } from '@/infra/pdf/nota';
import { pdfActaCorte } from '@/infra/pdf/acta';

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

async function textoDe(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  let t = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent();
    t += c.items.map((i) => ('str' in i ? i.str : '')).join(' ') + '\n';
  }
  return t;
}

describe('PDF del acta de corte', () => {
  it('generarlo dos veces da el mismo sha256', async () => {
    expect(huella(await pdfActaCorte(acta()))).toBe(huella(await pdfActaCorte(acta())));
  });
  it('trae las cifras del ejemplo del dueno y las dos firmas', async () => {
    const t = await textoDe(await pdfActaCorte(acta()));
    expect(t).toContain('CR-0001');
    expect(t).toContain('17,279.00');
    expect(t).toContain('8,639.50');
    expect(t).toContain('2,221.00');
    expect(t).toContain('Angelo');
    expect(t).toContain('Javier');
    expect(t).toContain('Reinvierte');
  });
});
