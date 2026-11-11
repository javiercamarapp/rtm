import { describe, it, expect } from 'vitest';
import { LibroCifras } from '@/dominio/reportes/cifras';
import { PLANTILLAS, anexoUmbrales, crearContexto, evaluarInsights, slug, type Insight } from '@/dominio/reportes/insights';
import type { HistoriaCliente, InsumosSemanal, LineaPedido, ModeloInventario, PedidoHistoria, PedidoInsumo } from '@/dominio/reportes/insumos';
import { renderMarcadores } from '@/dominio/reportes/texto';
import { CARTERA, INVENTARIO, insumosSemanalDorado } from '../../fixtures/reportes/datos';

const FIN = '2026-11-08';
const sumarDias = (f: string, d: number): string => {
  const x = new Date(Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10))) + d * 86_400_000);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
};

function correr(ins: InsumosSemanal) {
  const libro = new LibroCifras();
  const r = evaluarInsights(crearContexto(ins), libro, 'p');
  return { ...r, libro };
}
const ids = (ins: InsumosSemanal): string[] => correr(ins).insights.map((i) => i.id);
const sev = (ins: InsumosSemanal, id: string): string | undefined => correr(ins).insights.find((i) => i.id === id)?.severidad;
const pocos = (ins: InsumosSemanal, id: string): number => correr(ins).pocosDatos.filter((p) => p.id === id).length;
/** Sin pedidos del periodo ni ruido de otras reglas: base limpia para aislar una plantilla. */
const limpio = (sobre: Partial<InsumosSemanal> = {}): InsumosSemanal => insumosSemanalDorado({ clientes: [], inventario: [], cartera: [], liquidacion: undefined, conteo: undefined, socios: undefined, comparacionProveedores: [], gastos: [], plataforma: undefined, gastoVariablePorPiezaMedianaCent: undefined, ...sobre });

const linea = (modelo: string, piezas: number, precio: number, costo: number): LineaPedido => ({ modelo, piezas, precioCent: BigInt(precio), costoCent: BigInt(costo) });
const pedido = (folio: string, clienteId: string, cliente: string, lineas: LineaPedido[], extra: Partial<PedidoInsumo> = {}): PedidoInsumo => ({ folio, fecha: '2026-11-03', clienteId, cliente, origen: 'directo', lineas, cobradoCent: 0n, guiaCent: 0n, mensajeroCent: 0n, ...extra });

/** Historia de un cliente: un pedido por semana (pesos), de la mas antigua a la mas reciente; ceros = sin pedido. */
function historia(id: string, nombre: string, semanas: readonly number[], opciones: { precioPz?: number; sabores?: (k: number) => Record<string, number> } = {}): HistoriaCliente {
  const pedidos: PedidoHistoria[] = [];
  semanas.forEach((v, k) => {
    if (v <= 0) return;
    const atras = semanas.length - 1 - k;
    const piezas = Math.max(1, Math.round(v / (opciones.precioPz ?? 1)));
    pedidos.push({ fecha: sumarDias(FIN, -7 * atras - 2), piezas, ventasCent: BigInt(v * 100), contribCent: BigInt(v * 9), ...(opciones.sabores ? { sabores: opciones.sabores(k) } : {}) });
  });
  return { clienteId: id, cliente: nombre, pedidos };
}
const constante = (n: number, v: number) => Array.from({ length: n }, () => v);
/** Ocho semanas previas a 100 y cuatro recientes a r x 100. */
const ritmo = (r: number) => [...constante(8, 100), ...constante(4, Math.round(r * 100))];

const modelo = (sobre: Partial<ModeloInventario> & { modelo: string }): ModeloInventario => ({ existencia: 300, enTransito: 0, costoPromCent: 10_000n, ventasSemanales: constante(8, 100), contribPorPiezaCent: 1000n, diasSinVenta: 0, proveedor: 'Isaac', costoReposicionCent: 10_000n, leadTime: { dias: 7, reposiciones: 5, declarado: false }, piezasPorCaja: 150, sabores: [], ...sobre });

describe('inventario de plantillas', () => {
  it('son 25, con id unico, regla, umbral y muestra minima declarados', () => {
    expect(PLANTILLAS).toHaveLength(25);
    expect(new Set(PLANTILLAS.map((p) => p.id)).size).toBe(25);
    expect(PLANTILLAS.map((p) => p.id)).toEqual(Array.from({ length: 25 }, (_, i) => `I${String(i + 1).padStart(2, '0')}`));
    for (const a of anexoUmbrales()) {
      expect(a.regla.length).toBeGreaterThan(5);
      expect(a.umbral.length).toBeGreaterThan(2);
      expect(a.muestra.length).toBeGreaterThan(2);
    }
  });
  it('slug normaliza acentos y simbolos', () => {
    expect(slug('Nexa 50K')).toBe('nexa_50k');
    expect(slug('Cancún:Sandía')).toBe('cancun_sandia');
  });
});

describe('I01 cliente compra menos que su ritmo', () => {
  const con = (r: number) => limpio({ clientes: [historia('c1', 'Plaza', ritmo(r))] });
  it('dispara por severidad: 0.5 alerta, 0.7 atencion, 0.85 nota', () => {
    expect(sev(con(0.5), 'I01')).toBe('alerta');
    expect(sev(con(0.7), 'I01')).toBe('atencion');
    expect(sev(con(0.85), 'I01')).toBe('nota');
  });
  it('justo bajo el umbral (0.95) no dispara', () => {
    expect(ids(con(0.95))).not.toContain('I01');
  });
  it('sin muestra (menos de 4 pedidos) dice "pocos datos" y no dispara', () => {
    const ins = limpio({ clientes: [historia('c1', 'Plaza', [100, 100, 100])] });
    expect(ids(ins)).not.toContain('I01');
    expect(pocos(ins, 'I01')).toBe(1);
    expect(correr(ins).pocosDatos[0]!.frase).toBe('Pocos datos para hablar de el ritmo de Plaza (3 de 4).');
  });
  it('con menos de 4 pedidos y ritmo declarado compara contra lo declarado y lo rotula como hipotesis', () => {
    const h = { ...historia('c1', 'Plaza', [100, 100, 100]), declarado: { ventasSemanaCent: 450_000n, rangoPct: 20 } };
    const ins = limpio({ clientes: [h], pedidos: [pedido('P1', 'c1', 'Plaza', [linea('A', 1, 200_000, 100_000)])] });
    const r = correr(ins);
    const i = r.insights.find((x) => x.id === 'I01')!;
    expect(i.hipotesis).toBe(true);
    expect(i.severidad).toBe('nota');
    expect(renderMarcadores(i.frase, r.libro)).toContain('Declarado, no observado');
  });
});

describe('I02 recencia', () => {
  const con = (diasSinPedido: number) => {
    const h = historia('c1', 'Plaza', constante(1, 100));
    // pedidos cada 14 dias; el ultimo `diasSinPedido` antes del corte
    const fechas = [0, 1, 2, 3, 4].map((k) => sumarDias(FIN, -diasSinPedido - 14 * k));
    return limpio({ clientes: [{ ...h, pedidos: fechas.reverse().map((f) => ({ fecha: f, piezas: 10, ventasCent: 100_000n, contribCent: 9000n })) }] });
  };
  it('1.5 atencion, 2.5 alerta; justo debajo no dispara', () => {
    expect(ids(con(20))).not.toContain('I02');
    expect(sev(con(22), 'I02')).toBe('atencion');
    expect(sev(con(40), 'I02')).toBe('alerta');
  });
  it('sin muestra no dispara', () => {
    expect(pocos(limpio({ clientes: [historia('c1', 'P', [100, 100])] }), 'I02')).toBe(1);
  });
});

describe('I03 concentracion y I04 ranking de clientes', () => {
  const reparto = (vals: number[]) => vals.map((v, i) => pedido(`P${i}`, `c${i}`, `Cliente ${i}`, [linea('A', 10, v * 10_000, 0)]));
  it('mayor > 40 % alerta; > 30 % atencion; HHI > 2,500 atencion; justo debajo nada', () => {
    expect(sev(limpio({ pedidos: reparto([45, 15, 15, 15, 10]) }), 'I03')).toBe('alerta');
    expect(sev(limpio({ pedidos: reparto([35, 20, 15, 15, 15]) }), 'I03')).toBe('atencion');
    expect(ids(limpio({ pedidos: reparto([20, 20, 20, 20, 20]) }))).not.toContain('I03');
  });
  it('con menos de 5 clientes: pocos datos', () => {
    expect(pocos(limpio({ pedidos: reparto([50, 30, 20]) }), 'I03')).toBe(1);
  });
  it('I04: el cliente #1 en piezas queda fuera del top 3 en utilidad', () => {
    const peds = [pedido('P1', 'a', 'Grande', [linea('A', 500, 10_000, 9_990)]), pedido('P2', 'b', 'B', [linea('A', 100, 10_000, 5_000)]), pedido('P3', 'c', 'C', [linea('A', 100, 10_000, 5_000)]), pedido('P4', 'd', 'D', [linea('A', 100, 10_000, 5_000)])];
    expect(ids(limpio({ pedidos: peds }))).toContain('I04');
    const peds2 = [pedido('P1', 'a', 'Grande', [linea('A', 500, 10_000, 5_000)]), ...peds.slice(1)];
    expect(ids(limpio({ pedidos: peds2 }))).not.toContain('I04');
    expect(pocos(limpio({ pedidos: peds.slice(0, 2) }), 'I04')).toBe(1);
  });
});

describe('I05 posicion entre socios, I25 cuenta de Omar', () => {
  const socios = (d: bigint, a: bigint, neto = 0n, horas = 0) => ({ diferenciaCent: d, diferenciaAnteriorCent: a, omarNetoCent: neto, omarRentaCent: 44_000n, omarTomasCent: 70_000n, omarPagosCent: 0n, omarTomaPendienteHoras: horas });
  it('cambio > $5,000 dispara; $4,999 y menos del 20 % no', () => {
    expect(ids(limpio({ socios: socios(930_750n, 1_430_750n) }))).toContain('I05');
    expect(ids(limpio({ socios: socios(10_000_000n, 10_499_900n) }))).not.toContain('I05');
    expect(ids(limpio({ socios: socios(0n, 0n) }))).not.toContain('I05');
  });
  it('un cambio relativo mayor al 20 % tambien dispara', () => {
    expect(ids(limpio({ socios: socios(100_000n, 200_000n) }))).toContain('I05');
  });
  it('sin socios: pocos datos', () => {
    expect(pocos(limpio(), 'I05')).toBe(1);
    expect(pocos(limpio(), 'I25')).toBe(1);
  });
  it('I25: neto negativo o toma pendiente > 72 h', () => {
    expect(ids(limpio({ socios: socios(0n, 0n, -26_000n) }))).toContain('I25');
    expect(ids(limpio({ socios: socios(0n, 0n, 0n, 72) }))).not.toContain('I25');
    expect(ids(limpio({ socios: socios(0n, 0n, 0n, 73) }))).toContain('I25');
  });
});

describe('I06 ticket bajo', () => {
  const con = (ultimo: number) => limpio({ clientes: [{ ...historia('c1', 'Plaza', [400, 400, 400, 400, 400]), pedidos: [...[400, 400, 400, 400].map((v, k) => ({ fecha: sumarDias(FIN, -30 - 7 * k), piezas: 4, ventasCent: BigInt(v * 100), contribCent: 0n })), { fecha: '2026-11-04', piezas: 4, ventasCent: BigInt(ultimo * 100), contribCent: 0n }] }] });
  it('< 70 % de la mediana dispara; 71 % no', () => {
    expect(ids(con(270))).toContain('I06');
    expect(ids(con(285))).not.toContain('I06');
  });
  it('sin muestra o sin pedido en el periodo', () => {
    expect(pocos(limpio({ clientes: [historia('c1', 'P', [100, 100])] }), 'I06')).toBe(1);
    const viejo = limpio({ clientes: [{ ...historia('c1', 'P', [100]), pedidos: [1, 2, 3, 4].map((k) => ({ fecha: sumarDias(FIN, -30 - k), piezas: 1, ventasCent: 10_000n, contribCent: 0n })) }] });
    expect(ids(viejo)).not.toContain('I06');
  });
});

describe('I07 sabor abandonado', () => {
  const ped = (k: number): Record<string, number> => (k < 4 ? { 'Grape Ice': 50, Sandía: 50 } : { Sandía: 100 });
  const ins = (existencia: number) => limpio({ clientes: [historia('c1', 'Plaza', constante(12, 100), { sabores: ped })], inventario: [modelo({ modelo: 'M', sabores: [{ sabor: 'Grape Ice', existencia, vendidas28: 10, diasAgotado: 0 }] })] });
  it('dispara si cayo a menos de la mitad y hay existencia; sin existencia no', () => {
    expect(ids(ins(40))).toContain('I07');
    expect(ids(ins(0))).not.toContain('I07');
  });
  it('sin 3 pedidos y 60 pz: pocos datos', () => {
    expect(pocos(limpio({ clientes: [historia('c1', 'Plaza', [100, 100])] }), 'I07')).toBe(1);
  });
  it('si no cambia la participacion no dispara', () => {
    const igual = limpio({ clientes: [historia('c1', 'Plaza', constante(12, 100), { sabores: () => ({ 'Grape Ice': 50, Sandía: 50 }) })], inventario: ins(40).inventario });
    expect(ids(igual)).not.toContain('I07');
  });
});

describe('I08 modelo de mas piezas que no es de mas utilidad', () => {
  const peds = (utilPrimero: number) => [pedido('P1', 'a', 'A', [linea('Mucho', 500, 10_000, 10_000 - utilPrimero)]), pedido('P2', 'a', 'A', [linea('M2', 100, 10_000, 5_000), linea('M3', 90, 10_000, 5_000), linea('M4', 80, 10_000, 5_000)])];
  it('dispara si el #1 en piezas queda fuera del top 3 en utilidad', () => {
    expect(ids(limpio({ pedidos: peds(10) }))).toContain('I08');
    expect(ids(limpio({ pedidos: peds(4_000) }))).not.toContain('I08');
  });
  it('sin 20 pz o sin 4 modelos: pocos datos', () => {
    expect(pocos(limpio({ pedidos: [pedido('P', 'a', 'A', [linea('X', 10, 100, 50)])] }), 'I08')).toBe(1);
  });
});

describe('I09 caida de margen por cambio de costo', () => {
  const ins = (mediana: bigint, cambio = true) => limpio({ inventario: [modelo({ modelo: 'Icon', contribPorPiezaCent: 1100n, contribMedianaPorPiezaCent: mediana, ...(cambio ? { cambioCosto: { anteriorCent: 17_600n, nuevoCent: 19_000n, clientesAlMismoPrecio: 3 } } : {}) })] });
  it('dispara con caida >= $10; con >= 30 % tambien; justo debajo no', () => {
    expect(ids(ins(2_600n))).toContain('I09'); // cae $15
    expect(ids(limpio({ inventario: [modelo({ modelo: 'Icon', contribPorPiezaCent: 1100n, contribMedianaPorPiezaCent: 1700n, cambioCosto: { anteriorCent: 1n, nuevoCent: 2n, clientesAlMismoPrecio: 1 } })] }))).toContain('I09'); // cae 35 %
    expect(ids(ins(1_500n))).not.toContain('I09'); // cae $4 (26.7 %): justo debajo de ambos umbrales
  });
  it('sin cambio de costo registrado no se afirma causa', () => {
    expect(ids(ins(2_600n, false))).not.toContain('I09');
  });
  it('genera la recomendacion Renegociar con dinero estimado', () => {
    const r = correr(ins(2_600n));
    expect(r.recomendaciones[0]!.tipo).toBe('renegociar');
    expect(r.recomendaciones[0]!.dinero4semCent).toBeGreaterThan(0n);
  });
});

describe('I10 lineas bajo el piso e I11 precio fuera de tabulador', () => {
  const inv = [modelo({ modelo: 'X', costoReposicionCent: 17_800n })];
  it('I10 dispara si precio - reposicion < guia + $2; justo encima no', () => {
    const bajo = limpio({ inventario: inv, pedidos: [pedido('P1', 'a', 'A', [linea('X', 100, 18_000, 10_000)], { guiaCent: 10_000n })] });
    expect(ids(bajo)).toContain('I10');
    const bien = limpio({ inventario: inv, pedidos: [pedido('P1', 'a', 'A', [linea('X', 100, 20_000, 10_000)], { guiaCent: 10_000n })] });
    expect(ids(bien)).not.toContain('I10');
    const alerta = limpio({ inventario: inv, pedidos: [pedido('P1', 'a', 'A', [linea('X', 100, 17_000, 10_000)], { guiaCent: 10_000n })] });
    expect(sev(alerta, 'I10')).toBe('alerta');
  });
  it('I10 ignora modelos sin costo de reposicion y pedidos sin piezas', () => {
    expect(ids(limpio({ inventario: [], pedidos: [pedido('P1', 'a', 'A', [linea('X', 100, 100, 10)])] }))).not.toContain('I10');
    expect(ids(limpio({ inventario: inv, pedidos: [pedido('P1', 'a', 'A', [])] }))).not.toContain('I10');
  });
  it('I11 solo sin excepcion y con precio distinto', () => {
    const l = (extra: Partial<LineaPedido>): LineaPedido => ({ ...linea('X', 10, 19_000, 10_000), ...extra });
    expect(ids(limpio({ pedidos: [pedido('P1', 'a', 'A', [l({ precioTabuladorCent: 20_000n })])] }))).toContain('I11');
    expect(ids(limpio({ pedidos: [pedido('P1', 'a', 'A', [l({ precioTabuladorCent: 20_000n, conExcepcion: true })])] }))).not.toContain('I11');
    expect(ids(limpio({ pedidos: [pedido('P1', 'a', 'A', [l({ precioTabuladorCent: 19_000n })])] }))).not.toContain('I11');
  });
});

describe('I12 a I16 inventario', () => {
  const ocho = (revisar: ModeloInventario['revisar']) => Array.from({ length: 8 }, (_, i) => modelo({ modelo: `M${i}`, ...(i === 0 ? { revisar } : {}) }));
  it('I12: 3 semanas seguidas en Revisar con 8 modelos; con 2 semanas o 7 modelos no', () => {
    expect(ids(limpio({ inventario: ocho({ semanasSeguidas: 3, rotacionMilesimas: 2300n }) }))).toContain('I12');
    expect(ids(limpio({ inventario: ocho({ semanasSeguidas: 2, rotacionMilesimas: 2300n }) }))).not.toContain('I12');
    expect(pocos(limpio({ inventario: ocho(undefined).slice(0, 7) }), 'I12')).toBe(1);
  });
  it('I13: cobertura < 7 dias dispara (alerta < 3); 8 dias no; sin 4 semanas, pocos datos', () => {
    const base = { ventasSemanales: constante(8, 350) };
    expect(sev(limpio({ inventario: [modelo({ modelo: 'N', existencia: 312, ...base })] }), 'I13')).toBe('atencion');
    expect(sev(limpio({ inventario: [modelo({ modelo: 'N', existencia: 100, ...base })] }), 'I13')).toBe('alerta');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'N', existencia: 400, ...base })] }))).not.toContain('I13');
    expect(pocos(limpio({ inventario: [modelo({ modelo: 'N', ventasSemanales: [1, 2, 3] })] }), 'I13')).toBe(1);
  });
  it('I13 genera la recomendacion Reponer con costo de la compra', () => {
    const r = correr(limpio({ inventario: [modelo({ modelo: 'N', existencia: 100, ventasSemanales: constante(8, 350) })] }));
    expect(r.recomendaciones.find((x) => x.tipo === 'reponer')!.titulo).toContain('Reponer N');
  });
  it('I14: 21 dias sin venta o cobertura > 56 d, con existencia', () => {
    expect(ids(limpio({ inventario: [modelo({ modelo: 'F', existencia: 400, diasSinVenta: 21, ventasSemanales: [30, 30, 30, 30, 0, 0, 0, 0] })] }))).toContain('I14');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'F', existencia: 400, diasSinVenta: 20, ventasSemanales: constante(8, 350) })] }))).not.toContain('I14');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'F', existencia: 5000, ventasSemanales: constante(8, 100) })] }))).toContain('I14');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'F', existencia: 0, diasSinVenta: 40 })] }))).not.toContain('I14');
  });
  it('I15: sabor con > 20 % del stock y < 5 % de la demanda', () => {
    const sab = (e: number) => [{ sabor: 'Rainbow', existencia: e, vendidas28: 1, diasAgotado: 0 }, { sabor: 'Mango', existencia: 20, vendidas28: 60, diasAgotado: 0 }];
    expect(ids(limpio({ inventario: [modelo({ modelo: 'M', sabores: sab(90) })] }))).toContain('I15');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'M', sabores: sab(2) })] }))).not.toContain('I15');
    expect(ids(limpio({ inventario: [modelo({ modelo: 'M', sabores: [{ sabor: 'R', existencia: 90, vendidas28: 1, diasAgotado: 0 }] })] }))).not.toContain('I15');
  });
  it('I16: sabor agotado con >= 10 pz vendidas', () => {
    const s = (v: number, e: number) => modelo({ modelo: 'M', sabores: [{ sabor: 'Grape Ice', existencia: e, vendidas28: v, diasAgotado: 9 }] });
    expect(ids(limpio({ inventario: [s(10, 0)] }))).toContain('I16');
    expect(ids(limpio({ inventario: [s(9, 0)] }))).not.toContain('I16');
    expect(ids(limpio({ inventario: [s(50, 5)] }))).not.toContain('I16');
  });
});

describe('I17 conteo, I18 fuga, I19 a I21 dinero, I22 proveedor, I23 margen, I24 gastos', () => {
  it('I17: exactitud < 98 % o puente abierto; sin conteo, pocos datos', () => {
    expect(ids(limpio({ conteo: { lineasTotal: 44, lineasCuadran: 41, piezasPuente: 12, valorPuenteCent: 109_855n } }))).toContain('I17');
    expect(ids(limpio({ conteo: { lineasTotal: 44, lineasCuadran: 44, piezasPuente: 0, valorPuenteCent: 0n } }))).not.toContain('I17');
    expect(ids(limpio({ conteo: { lineasTotal: 44, lineasCuadran: 44, piezasPuente: 3, valorPuenteCent: 100n } }))).toContain('I17');
    expect(pocos(limpio(), 'I17')).toBe(1);
  });
  it('I18: salidas - cobradas - autorizadas distinto de cero', () => {
    const p = (salieron: number) => pedido('P-0127', 'a', 'A', [linea('X', 60, 10_000, 5_000)], { control: { salieron, cobradas: 60, autorizadas: 0 } });
    expect(ids(limpio({ pedidos: [p(62)] }))).toContain('I18');
    expect(ids(limpio({ pedidos: [p(60)] }))).not.toContain('I18');
    expect(ids(limpio({ pedidos: [pedido('P', 'a', 'A', [linea('X', 1, 1, 1)])] }))).not.toContain('I18');
  });
  it('I19: > 20 % de la cartera pasa de 30 dias, o partida > 60 dias', () => {
    const c = (dias: number, saldo = 1_000_000n) => [{ ...CARTERA[0]!, dias, saldoCent: saldo }, { ...CARTERA[1]!, dias: 5, saldoCent: saldo * 3n }];
    expect(ids(limpio({ cartera: c(40) }))).toContain('I19'); // 25 %
    const exacto = [{ ...CARTERA[0]!, dias: 40, saldoCent: 1_000_000n }, { ...CARTERA[1]!, dias: 5, saldoCent: 4_000_000n }];
    expect(ids(limpio({ cartera: exacto }))).not.toContain('I19'); // 20 % exacto: no supera el umbral
    expect(sev(limpio({ cartera: c(70, 100n) }), 'I19')).toBe('alerta');
    expect(ids(limpio({ cartera: c(10) }))).not.toContain('I19');
    expect(ids(limpio({ cartera: [] }))).not.toContain('I19');
  });
  it('I20: riesgo de cobro con puntos; sin 4 pedidos, pocos datos', () => {
    const c = (sobre: Partial<(typeof CARTERA)[number]>) => [{ ...CARTERA[0]!, ...sobre }];
    expect(ids(limpio({ cartera: c({ dias: 38, pagosMasLentos: true }) }))).toContain('I20');
    expect(sev(limpio({ cartera: c({ dias: 70, saldoCent: 20_000_000n, pagosMasLentos: true }) }), 'I20')).toBe('alerta');
    expect(ids(limpio({ cartera: c({ dias: 25, pagosMasLentos: false }) }))).not.toContain('I20');
    expect(pocos(limpio({ cartera: c({ pedidosHistoria: 2 }) }), 'I20')).toBe(1);
    expect(ids(limpio({ cartera: c({ saldoCent: 0n, dias: 90 }) }))).not.toContain('I20');
  });
  it('I21: cobertura del viernes < 1.2 atencion, < 1.0 alerta', () => {
    const liq = (fondos: bigint) => ({ proveedor: 'Isaac' as const, mercanciaCent: 41_557_000n, guiasCent: 709_800n, pagadoCent: 0n, fondosDisponiblesCent: fondos, cobrosEsperadosHastaViernesCent: 0n });
    expect(sev(limpio({ liquidacion: liq(48_000_000n) }), 'I21')).toBe('atencion');
    expect(sev(limpio({ liquidacion: liq(39_600_000n) }), 'I21')).toBe('alerta');
    expect(ids(limpio({ liquidacion: liq(55_000_000n) }))).not.toContain('I21');
    expect(ids(limpio({ liquidacion: { ...liq(0n), mercanciaCent: 0n, guiasCent: 0n } }))).not.toContain('I21');
    expect(pocos(limpio(), 'I21')).toBe(1);
    const r = correr(limpio({ liquidacion: liq(39_600_000n) }));
    expect(r.recomendaciones.some((x) => x.tipo === 'cobrar')).toBe(true);
  });
  it('I22: mismo modelo mas barato con el otro proveedor y se compro el caro', () => {
    const k = (n: number, caro = 190) => ({ modelo: 'Elux', costoIsaacCent: 17_600n, costoKarenCent: 16_800n, pedidosCaroSinCausa: n, piezasCaroSinCausa: caro, guiaPorPiezaCent: 380n });
    expect(ids(limpio({ comparacionProveedores: [k(2)] }))).toContain('I22');
    expect(ids(limpio({ comparacionProveedores: [k(0)] }))).not.toContain('I22');
    expect(ids(limpio({ comparacionProveedores: [{ ...k(2), costoKarenCent: 17_600n }] }))).not.toContain('I22');
    const karenCaro = correr(limpio({ comparacionProveedores: [{ ...k(1), costoKarenCent: 18_000n }] }));
    expect(karenCaro.insights.find((i) => i.id === 'I22')!.frase).toContain('con Isaac');
  });
  it('I23: margen bruto < 8 % atencion, < 5 % alerta; sin 2 semanas, pocos datos', () => {
    const peds = (costo: number) => [pedido('P1', 'a', 'A', [linea('X', 100, 10_000, costo)])];
    expect(sev(limpio({ pedidos: peds(9_300) }), 'I23')).toBe('atencion');
    expect(sev(limpio({ pedidos: peds(9_700) }), 'I23')).toBe('alerta');
    expect(ids(limpio({ pedidos: peds(9_000) }))).not.toContain('I23');
    expect(pocos(limpio({ historia: [] }), 'I23')).toBe(1);
  });
  it('I24: gasto variable por pieza > 20 % sobre su mediana, o plataforma > 80 % del tope', () => {
    const g = (monto: bigint) => [{ concepto: 'Guías', categoria: 'variable' as const, plataforma: false, montoCent: monto, pagadoPor: 'Angelo' as const }];
    const peds = [pedido('P1', 'a', 'A', [linea('X', 100, 10_000, 5_000)])];
    expect(ids(limpio({ pedidos: peds, gastos: g(50_000n), gastoVariablePorPiezaMedianaCent: 300n }))).toContain('I24');
    expect(ids(limpio({ pedidos: peds, gastos: g(50_000n), gastoVariablePorPiezaMedianaCent: 450n }))).not.toContain('I24');
    expect(ids(limpio({ plataforma: { topeCent: 54_000n, gastoCent: 50_000n } }))).toContain('I24');
    expect(sev(limpio({ plataforma: { topeCent: 54_000n, gastoCent: 54_000n } }), 'I24')).toBe('alerta');
    expect(ids(limpio({ plataforma: { topeCent: 54_000n, gastoCent: 12_000n } }))).not.toContain('I24');
    expect(pocos(limpio({ pedidos: peds, gastos: g(50_000n), gastoVariablePorPiezaMedianaCent: 300n, historia: [] }), 'I24')).toBe(1);
  });
});

describe('recomendaciones: prioridad = dinero x urgencia x confianza, orden estable', () => {
  it('el orden es estable entre corridas y los marcadores resuelven contra el paquete', () => {
    const a = correr(insumosSemanalDorado());
    const b = correr(insumosSemanalDorado());
    expect(a.recomendaciones.map((r) => r.titulo)).toEqual(b.recomendaciones.map((r) => r.titulo));
    expect(a.insights.map((i) => i.frase)).toEqual(b.insights.map((i) => i.frase));
    for (const r of a.recomendaciones) expect(() => renderMarcadores(r.titulo, a.libro)).not.toThrow();
    const prio = a.recomendaciones.map((r) => r.prioridad);
    expect([...prio].sort((x, y) => (x > y ? -1 : x < y ? 1 : 0))).toEqual(prio);
    expect(a.recomendaciones.length).toBeLessThanOrEqual(5);
  });
  it('mas urgencia (vence en 7 dias) pesa mas que menos urgencia con el mismo dinero', () => {
    const a = correr(insumosSemanalDorado());
    const cobrar = a.recomendaciones.find((r) => r.tipo === 'cobrar')!;
    const dejar = a.recomendaciones.find((r) => r.tipo === 'dejar_de_surtir')!;
    expect(cobrar.prioridad).toBe(cobrar.dinero4semCent * 3n * 10n);
    expect(dejar.prioridad).toBe(dejar.dinero4semCent * 2n * 10n);
  });
  it('los hallazgos se ordenan por severidad y luego por dinero', () => {
    const r = correr(insumosSemanalDorado());
    const rango = { alerta: 3, atencion: 2, nota: 1 } as const;
    const orden = r.insights.map((i: Insight) => rango[i.severidad]);
    expect([...orden].sort((x, y) => y - x)).toEqual(orden);
  });
  it('dos disparos de la misma entidad no chocan en id', () => {
    const r = correr(limpio({ inventario: [modelo({ modelo: 'N', sabores: [{ sabor: 'Grape Ice', existencia: 0, vendidas28: 20, diasAgotado: 9 }, { sabor: 'Grape Ice', existencia: 0, vendidas28: 20, diasAgotado: 9 }] })] }));
    const ids16 = r.insights.filter((i) => i.id === 'I16');
    expect(ids16).toHaveLength(2);
    expect(r.libro.tiene('ins.I16.n_grape_ice.dias')).toBe(true);
    expect(r.libro.tiene('ins.I16.n_grape_ice_1.dias')).toBe(true);
  });
});
