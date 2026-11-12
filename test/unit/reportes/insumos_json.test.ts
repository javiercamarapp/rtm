import { describe, expect, it } from 'vitest';
import { insumosMensualDeJson, insumosSemanalDeJson, paqueteAJson } from '@/infra/reportes/insumos_json';
import { armarPaquete } from '@/dominio/reportes/paquete';

// Forma exacta que entrega rep.insumos_semanal (probada con pgTAP): un pedido de 20 piezas a 150.00 con costo de 100.00 y guia de 180.00.
const comprobaciones = ['C3', 'C4', 'C5', 'C10', 'C11', 'C12'].map((id) => ({ id, nombre: id, via1_cent: 0, via2_cent: 0, ok: true, unidad: 'cent' }));
const semanal = {
  inicio: '2026-11-09', fin: '2026-11-15', corte_iso: '2026-11-16T11:59:00Z', aprobado_en: null, en_curso: false, datos_incompletos: [], semana_iso: 46, anio: 2026,
  pedidos: [{ folio: 'P-0001', fecha: '2026-11-10', cliente_id: '7', cliente: 'Cliente Ilustrativo', origen: 'bodega', lineas: [{ modelo: 'Modelo 10K', sabor: 'Sandia', piezas: 20, precio_cent: 15000, costo_cent: 10000, precio_tabulador_cent: 15000, con_excepcion: false }],
    cobrado_cent: 300000, guia_cent: 18000, mensajero_cent: 0, avisos: [], control: { salieron: 20, cobradas: 20, autorizadas: 0 } }],
  pedidos_anterior: [], historia: [], clientes: [], inventario: [], cartera: [], gastos: [], comparacion_proveedores: [], comprobaciones, plataforma: { tope_cent: 300000, gasto_cent: 0 },
};

describe('insumos de la base a los tipos del motor', () => {
  it('convierte centavos a bigint y conserva piezas como enteros', () => {
    const i = insumosSemanalDeJson(semanal);
    expect(i.pedidos[0]!.lineas[0]!.precioCent).toBe(15000n);
    expect(i.pedidos[0]!.cobradoCent).toBe(300000n);
    expect(i.pedidos[0]!.lineas[0]!.piezas).toBe(20);
    expect(i.comprobaciones[0]).toMatchObject({ id: 'C3', ok: true, unidad: 'cent' });
    expect(i.plataforma).toEqual({ topeCent: 300000n, gastoCent: 0n });
    expect(i.aprobadoEn).toBeUndefined();
  });
  it('las secciones que la base no entrega se omiten, no se inventan', () => {
    const i = insumosSemanalDeJson(semanal);
    expect(i.liquidacion).toBeUndefined();
    expect(i.socios).toBeUndefined();
    expect(i.flujo).toBeUndefined();
    expect(i.conteo).toBeUndefined();
  });
  it('el motor arma el paquete con lo que entrega la base: periodo en curso o con datos incompletos sale PARCIAL, sin aprobar sale PRELIMINAR', () => {
    const cerrado = armarPaquete(insumosSemanalDeJson(semanal));
    expect(cerrado.estado.etiquetas).toContain('PRELIMINAR');
    const parcial = armarPaquete(insumosSemanalDeJson({ ...semanal, datos_incompletos: ['guias_sin_costear'] }));
    expect(parcial.estado.etiquetas).toContain('PARCIAL');
    const definitivo = armarPaquete(insumosSemanalDeJson({ ...semanal, aprobado_en: '2026-11-16T14:00:00Z' }));
    expect(definitivo.estado.etiquetas).toEqual(['DEFINITIVO']);
    expect(definitivo.estado.sale).toBe(true);
  });
  it('una comprobacion bloqueante en rojo impide que salga el PDF', () => {
    const roto = { ...semanal, comprobaciones: comprobaciones.map((c) => (c.id === 'C3' ? { ...c, via1_cent: 5000, ok: false } : c)) };
    const p = armarPaquete(insumosSemanalDeJson(roto));
    expect(p.estado.sale).toBe(false);
    expect(p.estado.bloqueantes).toEqual(['C3']);
  });
  it('el mensual conserva el estado de resultados con la utilidad neta por dos vias', () => {
    const m = insumosMensualDeJson({
      ...semanal, mes: '2026-11', resultados: [
        { id: 'ventasNetas', etiqueta: 'Ventas netas', cuenta: '4110', monto_cent: 300000, mes_anterior_cent: 0, mediana_tres_meses_cent: 0, subtotal: false, signo: 1 },
        { id: 'costoVentas', etiqueta: 'Costo de ventas', cuenta: '5100', monto_cent: 200000, mes_anterior_cent: 0, mediana_tres_meses_cent: 0, subtotal: false, signo: -1 },
        { id: 'utilidadNeta', etiqueta: 'Utilidad neta', cuenta: '', monto_cent: 100000, mes_anterior_cent: 0, mediana_tres_meses_cent: 0, subtotal: true, signo: 1 }],
      utilidad_neta_cent: 100000, costos_sistema: { cargo_sociedad_cent: 23600, como_seria_cent: 0, como_deberia_cent: 0, bolsillo_javier_cent: 23600, reembolsado_cent: 10000, pendiente_cent: 13600 },
      ventas_mensuales_cent: [300000], cliente_sabor: [], rank_semanal_clientes: [], dso_dias: 0, tendencia_cartera_bp: [],
    });
    expect(m.utilidadNetaCent).toBe(100000n);
    expect(m.costosSistema).toMatchObject({ cargoSociedadCent: 23600n, pendienteCent: 13600n, reembolsadoCent: 10000n });
    expect(m.resultados.filter((r) => !r.subtotal).reduce((a, r) => a + BigInt(r.signo) * r.montoCent, 0n)).toBe(m.utilidadNetaCent);
  });
  it('el paquete se guarda con bigint como texto', () => {
    expect(JSON.parse(paqueteAJson({ a: 5n, b: [1n, 2] }))).toEqual({ a: '5', b: ['1', 2] });
  });
});
