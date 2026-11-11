import { describe, it, expect } from 'vitest';
import { armarPaquete, cifraDe, etiquetaMes, etiquetaPeriodoSemanal } from '@/dominio/reportes/paquete';
import { construirReporte, reporteATexto } from '@/dominio/reportes/paginas';
import { renderHtml } from '@/dominio/reportes/html';
import { construirAvisoNoSale, construirCorreo, construirTelegram } from '@/dominio/reportes/entrega';
import { verificarTexto } from '@/dominio/reportes/guardia';
import { contextoGuardia } from '@/dominio/reportes/paginas';
import type { InsumosMensual, InsumosSemanal, PedidoInsumo } from '@/dominio/reportes/insumos';
import { insumosMensualDorado, insumosSemanalDorado, PEDIDOS_SEMANA } from '../../fixtures/reportes/datos';

const vacio = (sobre: Partial<InsumosSemanal> = {}): InsumosSemanal => insumosSemanalDorado({ pedidos: [], pedidosSemanaAnterior: [], historia: [], clientes: [], inventario: [], cartera: [], liquidacion: undefined, gastos: [], conteo: undefined, socios: undefined, flujo: undefined, comparacionProveedores: [], plataforma: undefined, gastoVariablePorPiezaMedianaCent: undefined, ...sobre });
const vacioMes = (sobre: Partial<InsumosMensual> = {}): InsumosMensual => insumosMensualDorado({ pedidos: [], pedidosSemanaAnterior: [], mesAnterior: [], historia: [], clientes: [], inventario: [], cartera: [], liquidacion: undefined, gastos: [], conteo: undefined, socios: undefined, flujo: undefined, comparacionProveedores: [], plataforma: undefined, gastoVariablePorPiezaMedianaCent: undefined, resultados: [], costosSistema: undefined, ventasMensualesCent: [], clienteSabor: [], rankSemanalClientes: [], tendenciaCarteraBp: [], ...sobre });

describe('sin historia no se emite ninguna proyeccion', () => {
  const proyecciones = (p: ReturnType<typeof armarPaquete>) => p.cifras.filter((c) => (c.clase === 'Estimado' || c.clase === 'Escenario') && c.estado === 'ok');
  it('semana sin historia, sin inventario con ventas y sin flujo: ninguna cifra Estimado ni Escenario', () => {
    const p = armarPaquete(vacio({ pedidos: PEDIDOS_SEMANA }));
    expect(proyecciones(p).map((c) => c.id)).toEqual([]);
  });
  it('mes sin historia: la proyeccion es una cifra sin datos y la pagina dice que falta para estimar', () => {
    const p = armarPaquete(insumosMensualDorado({ historia: [], ventasMensualesCent: [], flujo: undefined, inventario: [] }));
    expect(proyecciones(p).map((c) => c.id)).toEqual([]);
    const c = cifraDe(p, 'proy.central')!;
    expect(c.estado).toBe('sin_datos');
    expect(c.metodo).toBe('requeridos:6');
    const r = construirReporte(p);
    const pag = r.paginas[11]!;
    expect(pag.titular).toBe('Aún falta historia para estimar la utilidad.');
    expect(pag.implicacion).toContain('Qué falta para estimar');
    expect(pag.notas.join(' ')).toContain('No se estima: faltan 6 semanas (mínimo 6)');
    expect(pag.graficas).toEqual([]);
  });
  it('con 5 semanas (minimo - 1) no se emite; con 6 si', () => {
    const hist = insumosMensualDorado().historia;
    const cinco = armarPaquete(insumosMensualDorado({ historia: hist.slice(-5) }));
    expect(cifraDe(cinco, 'proy.central')!.estado).toBe('sin_datos');
    expect(cinco.proyeccionNota.join(' ')).toContain('faltan 1 semanas');
    const seis = armarPaquete(insumosMensualDorado({ historia: hist.slice(-6) }));
    expect(cifraDe(seis, 'proy.central')!.estado).toBe('ok');
    expect(cifraDe(seis, 'proy.central')!.clase).toBe('Estimado');
    expect(cifraDe(seis, 'proy.central')!.rango).toBeDefined();
  });
  it('un modelo con menos de 4 semanas de ventas no trae cobertura ni punto de reorden', () => {
    const inv = insumosSemanalDorado().inventario.map((m) => ({ ...m, ventasSemanales: [10, 10] }));
    const p = armarPaquete(insumosSemanalDorado({ inventario: inv }));
    expect(p.cifras.filter((c) => c.id.startsWith('cob.')).every((c) => c.estado === 'sin_datos')).toBe(true);
    expect(p.cifras.some((c) => c.id.startsWith('rep.'))).toBe(false);
    expect(p.tablas.reposicion!.filas).toEqual([]);
    expect(cifraDe(p, 'inv.inmovilizado')!.valor).toBeGreaterThanOrEqual(0n);
  });
  it('flujo sin 8 semanas de cobros ni cadencia: no se emite y se dice por que', () => {
    const f = { ...insumosSemanalDorado().flujo!, cobrosSemanalesCent: [1n, 2n] };
    const p = armarPaquete(insumosSemanalDorado({ flujo: f }));
    expect(cifraDe(p, 'flujo.minimo')!.estado).toBe('sin_datos');
    expect(p.graficas.flujo).toBeNull();
    expect(p.proyeccionNota.join(' ')).toContain('Flujo de caja: No se estima');
    const r = construirReporte(p);
    expect(r.paginas[4]!.notas.join(' ')).toContain('No se estima');
  });
});

describe('reportes con datos escasos o vacios no se rompen', () => {
  it('semana vacia: construye paquete, paginas, HTML, Telegram y correo honestos', () => {
    const p = armarPaquete(vacio());
    expect(p.estado.sale).toBe(true);
    const r = construirReporte(p);
    expect(r.paginas).toHaveLength(7);
    const t = reporteATexto(r);
    expect(t).toContain('Sin gastos en el periodo.');
    expect(t).toContain('aún no hay periodo comparable');
    expect(t).toContain('sin datos');
    const html = renderHtml(r, { cssFuentes: '' });
    expect(html).toContain('<section');
    expect(construirTelegram(p)).toContain('Reporte semanal');
    expect(construirCorreo(p).cuerpo).toContain('Adjunto el reporte semanal');
  });
  it('mes vacio construye las 12 paginas con mensajes de falta de muestra', () => {
    const p = armarPaquete(vacioMes());
    const r = construirReporte(p);
    expect(r.paginas).toHaveLength(12);
    const t = reporteATexto(r);
    expect(t).toContain('Aún no hay muestra para el mapa de gustos.');
    expect(t).toContain('Aún no hay muestra para clasificar los modelos.');
    expect(t).toContain('Aún no hay base para proyectar el flujo de caja.');
    expect(t).toContain('Sin datos de proveedores en el periodo.');
  });
  it('menos de 5 clientes: no hay Pareto ni concentracion, solo la frase de falta de muestra', () => {
    const p = armarPaquete(vacio({ pedidos: PEDIDOS_SEMANA.filter((x) => x.clienteId === 'c1' || x.clienteId === 'c2') }));
    expect(p.graficas.pareto).toBeNull();
    expect(cifraDe(p, 'cli.top2Pct')!.estado).toBe('sin_datos');
    expect(construirReporte(p).paginas[2]!.titular).toBe('Sin datos de concentración de clientes en el periodo.');
  });
  it('utilidad negativa: el titular dice que baja, el signo es real y la guardia lo acepta', () => {
    const peor: PedidoInsumo[] = PEDIDOS_SEMANA.map((p) => ({ ...p, lineas: p.lineas.map((l) => ({ ...l, costoCent: l.costoCent + 3_000n })) }));
    const p = armarPaquete(insumosSemanalDorado({ pedidos: peor }));
    expect(cifraDe(p, 'contrib')!.valor).toBeLessThan(0n);
    const r = construirReporte(p);
    expect(r.paginas[0]!.heroe!.valor.startsWith('−$')).toBe(true);
    expect(r.paginas[0]!.titular).toContain('baja');
    expect(verificarTexto(construirTelegram(p), contextoGuardia(p)).ok).toBe(true);
  });
  it('utilidad igual a la del periodo anterior: se mantiene', () => {
    const p = armarPaquete(insumosSemanalDorado({ pedidos: insumosSemanalDorado().pedidosSemanaAnterior }));
    expect(construirReporte(p).paginas[1]!.titular).toBe('La utilidad de contribución se mantiene en $44,500.');
  });
  it('un periodo que cruza de mes se rotula con ambos meses', () => {
    expect(etiquetaPeriodoSemanal('2026-10-26', '2026-11-01')).toBe('26 de octubre al 1 de noviembre de 2026');
    expect(etiquetaPeriodoSemanal('2026-11-02', '2026-11-08')).toBe('2 al 8 de noviembre de 2026');
    expect(etiquetaMes('2026-10')).toBe('Octubre 2026');
  });
  it('un pedido con mas de 8 renglones pone el resto en la nota; con exactamente 8 no hay nota', () => {
    const p = armarPaquete(insumosSemanalDorado());
    expect(p.tablas.pedidos!.filas).toHaveLength(8);
    expect(p.tablas.pedidos!.nota).toContain('Resto: 6 pedidos');
    const p8 = armarPaquete(insumosSemanalDorado({ pedidos: PEDIDOS_SEMANA.slice(0, 8) }));
    expect(p8.tablas.pedidos!.nota).toBeUndefined();
  });
  it('aviso de no salida sin diferencia en pesos usa el id de la comprobacion', () => {
    const c = insumosSemanalDorado().comprobaciones.map((x) => (x.id === 'C10' ? { ...x, ok: false, via2: 9n } : x));
    const p = armarPaquete(insumosSemanalDorado({ comprobaciones: c }));
    expect(construirAvisoNoSale(p)).toBe("El reporte semanal no salió: falla C10. Corrijan y escriban 'reintentar reporte'.");
  });
  it('Telegram se recorta de abajo hacia arriba para no pasar de 900 caracteres', () => {
    const largo = insumosSemanalDorado({ clientes: insumosSemanalDorado().clientes });
    const p = armarPaquete(largo);
    expect(construirTelegram(p).length).toBeLessThanOrEqual(900);
  });
  it('socios debe Angelo a Javier cuando la diferencia es negativa', () => {
    const p = armarPaquete(insumosSemanalDorado({ socios: { diferenciaCent: -500_000n, diferenciaAnteriorCent: -500_000n, omarNetoCent: 100n, omarRentaCent: 1n, omarTomasCent: 1n, omarPagosCent: -98n, omarTomaPendienteHoras: 0 } }));
    expect(construirReporte(p).paginas[6]!.titular).toContain('Angelo debe a Javier');
  });
  it('liquidacion con faltante: el titular dice faltante', () => {
    const l = { ...insumosSemanalDorado().liquidacion!, fondosDisponiblesCent: 0n, cobrosEsperadosHastaViernesCent: 1_000_000n };
    const p = armarPaquete(insumosSemanalDorado({ liquidacion: l }));
    expect(construirReporte(p).paginas[4]!.titular).toContain('faltante');
  });
  it('la comprobacion de la hoja del proveedor distinta del saldo calculado es una cifra que no cuadra y bloquea', () => {
    const l = { ...insumosSemanalDorado().liquidacion!, segunProveedorCent: 1n };
    const p = armarPaquete(insumosSemanalDorado({ liquidacion: l }));
    expect(p.estado.sale).toBe(false);
    expect(p.estado.bloqueantes).toContain('R.CIFRAS');
  });
});
