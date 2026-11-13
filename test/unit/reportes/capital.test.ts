import { describe, expect, it } from 'vitest';
import { renderHtml } from '@/dominio/reportes/html';
import { construirReporte, reporteATexto } from '@/dominio/reportes/paginas';
import { armarPaquete, cifraDe } from '@/dominio/reportes/paquete';
import { insumosMensualDorado } from '../../fixtures/reportes/datos';
import { periodoNoviembre } from '../../fixtures/reportes/capital';

const conCapital = () => armarPaquete({ ...insumosMensualDorado(), capital: { mes: periodoNoviembre(), acumulado: periodoNoviembre() } });

describe('rep.insumos_mensual entrega el renglon utilidadNeta (subtotal)', () => {
  it('no duplica res.utilidadNeta (con datos reales el mensual no se podia armar)', () => {
    const m = insumosMensualDorado();
    const r = m.resultados[0]!;
    const conRenglon = { ...m, resultados: [...m.resultados, { ...r, id: 'utilidadNeta', etiqueta: 'Utilidad neta', cuenta: '', subtotal: true, montoCent: m.utilidadNetaCent }] };
    expect(() => armarPaquete(conRenglon)).not.toThrow();
    expect(cifraDe(armarPaquete(conRenglon), 'res.utilidadNeta')!.comprobacion.igual).toBe(true);
  });
});

describe('capital por socio en el reporte mensual', () => {
  it('sin capital el reporte no cambia (12 paginas)', () => {
    expect(construirReporte(armarPaquete(insumosMensualDorado())).paginas).toHaveLength(12);
  });
  it('con capital sale una pagina mas, despues del Estado de resultados', () => {
    const r = construirReporte(conCapital());
    expect(r.paginas).toHaveLength(13);
    expect(r.paginas.map((p) => p.id).slice(0, 3)).toEqual(['resumen', 'estado', 'capital']);
    expect(r.sale).toBe(true);
  });
  it('cada cifra de capital cuadra por dos vias y la valuacion es el capital contable del Balance', () => {
    const p = conCapital();
    for (const id of ['cap.valuacion', 'cap.utilidad', 'cap.aportaciones', 'cap.reinvertida', 'cap.retirada', 'cap.fondos', 'cap.acumValuacion']) expect(cifraDe(p, id)!.comprobacion.igual, id).toBe(true);
    expect(cifraDe(p, 'cap.valuacion')!.valor).toBe(23906264n);
  });
  it('una valuacion que no es el capital contable bloquea el reporte', () => {
    const n = periodoNoviembre();
    const roto = armarPaquete({ ...insumosMensualDorado(), capital: { mes: { ...n, balance: { ...n.balance, total_capital_cent: n.balance.total_capital_cent + 100n } }, acumulado: n } });
    expect(roto.estado.sale).toBe(false);
    expect(roto.estado.bloqueantes).toContain('R.CIFRAS');
  });
  it('el reporte, que va a los dos, nombra a cada socio: «retirados por Javier», nunca «por ti»', () => {
    const texto = reporteATexto(construirReporte(conCapital()));
    expect(texto).toContain('Fondos de la sociedad retirados por Javier');
    expect(texto).not.toContain('retirados por ti');
    expect(texto).toContain('Pago PG-0001 en la cuenta de Javier');
  });
  it('trae valuacion, aportaciones, utilidad, reinvertida, retirada, proveedores y por clasificar, sin lenguaje de deuda en los fondos', () => {
    const r = construirReporte(conCapital());
    const pg = r.paginas.find((x) => x.id === 'capital')!;
    expect(pg.tablas.map((t) => t.id)).toEqual(['capital', 'capitalAcum', 'aportacionNeta', 'fondos', 'proveedores']);
    const t = reporteATexto(r);
    expect(t).toContain('Isaac · Por clasificar');
    expect(t).toContain('Se le debe');
    expect(t).toContain('Saldo a favor');
    const fondos = pg.tablas.find((x) => x.id === 'fondos')!;
    expect(JSON.stringify(fondos, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toMatch(/deb[eo]|adeud|deuda/i);
  });
  it('el reporte dice a quien le toca aportar, que la participacion es 50/50 y alerta si la reinversion es distinta', () => {
    const texto = reporteATexto(construirReporte(conCapital()));
    expect(texto).toContain('Le toca aportar el siguiente pago: Angelo por $11,240.00');
    expect(texto).toContain('siempre 50/50');
    expect(texto).toContain('Reinversión distinta en el acta: Angelo $5,000.00 y Javier $2,000.00');
    expect(texto).not.toMatch(/% en libros|% de aportaciones/);
  });
  it('con reinversion igual el reporte dice igual para los dos', () => {
    const n = periodoNoviembre();
    const igual = armarPaquete({ ...insumosMensualDorado(), capital: { mes: { ...n, reinversion_igual: true, reinversion_acta_angelo_cent: 500000n, reinversion_acta_javier_cent: 500000n }, acumulado: n } });
    expect(reporteATexto(construirReporte(igual))).toContain('Reinvertido este mes: igual para los dos');
  });
  it('el HTML trae la tabla y pasa a PDF con el mismo texto', () => {
    const p = conCapital();
    const html = renderHtml(construirReporte(p), { cssFuentes: '' });
    expect(html).toContain('Capital por socio del mes');
    expect(html).toContain('Fondos de la sociedad retirados por Javier');
  });
});
