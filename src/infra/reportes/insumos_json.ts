// Convierte lo que entregan `rep.insumos_semanal` y `rep.insumos_mensual` (jsonb, claves snake_case, centavos `*_cent` como numeros enteros) a los tipos del motor.
// Es la unica conversion: ningun calculo de negocio ocurre aqui.
import type { ComparacionProveedor, ConteoInsumo, FlujoInsumo, GastoInsumo, HistoriaCliente, InsumosMensual, InsumosSemanal, LineaPedido, LiquidacionProveedor, ModeloInventario, PartidaCartera, PedidoInsumo, RenglonResultados, SemanaHistoria, SociosInsumo } from '@/dominio/reportes/insumos';
import type { ResultadoComprobacion } from '@/dominio/reportes/tipos';

type J = Record<string, unknown>;
const big = (v: unknown): bigint => BigInt(v === null || v === undefined ? 0 : (v as number | string | bigint));
const num = (v: unknown): number => Number(v ?? 0);
const txt = (v: unknown): string => String(v ?? '');
const arr = (v: unknown): J[] => (Array.isArray(v) ? (v as J[]) : []);
const bigArr = (v: unknown): bigint[] => (Array.isArray(v) ? v.map(big) : []);

function linea(j: J): LineaPedido {
  return {
    modelo: txt(j.modelo), ...(j.sabor ? { sabor: txt(j.sabor) } : {}), piezas: num(j.piezas), precioCent: big(j.precio_cent), costoCent: big(j.costo_cent),
    ...(j.precio_tabulador_cent !== null && j.precio_tabulador_cent !== undefined ? { precioTabuladorCent: big(j.precio_tabulador_cent) } : {}), ...(j.con_excepcion === true ? { conExcepcion: true } : {}),
  };
}

function pedido(j: J): PedidoInsumo {
  const c = j.control as J | undefined;
  return {
    folio: txt(j.folio), fecha: txt(j.fecha), clienteId: txt(j.cliente_id), cliente: txt(j.cliente), origen: j.origen === 'directo' ? 'directo' : 'bodega', lineas: arr(j.lineas).map(linea),
    cobradoCent: big(j.cobrado_cent), guiaCent: big(j.guia_cent), mensajeroCent: big(j.mensajero_cent), avisos: Array.isArray(j.avisos) ? (j.avisos as unknown[]).map(txt) : [],
    ...(c ? { control: { salieron: num(c.salieron), cobradas: num(c.cobradas), autorizadas: num(c.autorizadas) } } : {}),
  };
}

function semana(j: J): SemanaHistoria {
  return { inicio: txt(j.inicio), ventasCent: big(j.ventas_cent), piezas: num(j.piezas), contribCent: big(j.contrib_cent), cobradoCent: big(j.cobrado_cent) };
}

function cliente(j: J): HistoriaCliente {
  return {
    clienteId: txt(j.cliente_id), cliente: txt(j.cliente),
    pedidos: arr(j.pedidos).map((p) => ({ fecha: txt(p.fecha), piezas: num(p.piezas), ventasCent: big(p.ventas_cent), contribCent: big(p.contrib_cent), ...(p.sabores ? { sabores: p.sabores as Record<string, number> } : {}) })),
  };
}

function modelo(j: J): ModeloInventario {
  const lt = j.lead_time as J;
  return {
    modelo: txt(j.modelo), existencia: num(j.existencia), enTransito: num(j.en_transito), costoPromCent: big(j.costo_prom_cent), ventasSemanales: ((j.ventas_semanales as unknown[]) ?? []).map(num),
    contribPorPiezaCent: big(j.contrib_por_pieza_cent), diasSinVenta: num(j.dias_sin_venta), proveedor: j.proveedor === 'Karen' ? 'Karen' : 'Isaac', costoReposicionCent: big(j.costo_reposicion_cent),
    leadTime: { dias: num(lt.dias), reposiciones: num(lt.reposiciones), declarado: lt.declarado === true }, piezasPorCaja: Math.max(1, num(j.piezas_por_caja)),
    sabores: arr(j.sabores).map((s) => ({ sabor: txt(s.sabor), existencia: num(s.existencia), vendidas28: num(s.vendidas28), diasAgotado: num(s.dias_agotado) })),
  };
}

function cartera(j: J): PartidaCartera {
  return { clienteId: txt(j.cliente_id), cliente: txt(j.cliente), saldoCent: big(j.saldo_cent), dias: num(j.dias), ticketMedianoCent: big(j.ticket_mediano_cent), pagosMasLentos: j.pagos_mas_lentos === true, pedidosHistoria: num(j.pedidos_historia) };
}

function gasto(j: J): GastoInsumo {
  const pagado = txt(j.pagado_por);
  return { concepto: txt(j.concepto), categoria: j.categoria === 'fijo' ? 'fijo' : 'variable', plataforma: j.plataforma === true, montoCent: big(j.monto_cent), pagadoPor: pagado === 'Angelo' || pagado === 'Javier' ? pagado : 'Sociedad' };
}

function comprobacion(j: J): ResultadoComprobacion {
  const u = txt(j.unidad);
  return { id: txt(j.id), nombre: txt(j.nombre), via1: big(j.via1_cent), via2: big(j.via2_cent), ok: j.ok === true, unidad: u === 'cent' || u === 'pz' || u === 'n' ? u : 'cent' };
}

export function insumosSemanalDeJson(j: J): InsumosSemanal {
  const p = j.plataforma as J | undefined;
  return {
    inicio: txt(j.inicio), fin: txt(j.fin), corteIso: txt(j.corte_iso), ...(j.aprobado_en ? { aprobadoEn: txt(j.aprobado_en) } : {}), enCurso: j.en_curso === true,
    datosIncompletos: ((j.datos_incompletos as unknown[]) ?? []).map(txt), semanaIso: num(j.semana_iso), anio: num(j.anio),
    pedidos: arr(j.pedidos).map(pedido), pedidosSemanaAnterior: arr(j.pedidos_anterior).map(pedido), historia: arr(j.historia).map(semana), clientes: arr(j.clientes).map(cliente),
    inventario: arr(j.inventario).map(modelo), cartera: arr(j.cartera).map(cartera), gastos: arr(j.gastos).map(gasto), comparacionProveedores: arr(j.comparacion_proveedores) as unknown as ComparacionProveedor[],
    comprobaciones: arr(j.comprobaciones).map(comprobacion),
    ...(p ? { plataforma: { topeCent: big(p.tope_cent), gastoCent: big(p.gasto_cent) } } : {}),
    // Secciones que la base todavia no entrega (se omiten, no se inventan): liquidacion con la hoja del proveedor, conteo ciego, cuenta entre socios con comparativo, flujo con cobros prometidos.
    ...({} as { liquidacion?: LiquidacionProveedor; conteo?: ConteoInsumo; socios?: SociosInsumo; flujo?: FlujoInsumo }),
  };
}

function renglon(j: J): RenglonResultados {
  return { id: txt(j.id), etiqueta: txt(j.etiqueta), cuenta: txt(j.cuenta), montoCent: big(j.monto_cent), mesAnteriorCent: big(j.mes_anterior_cent), medianaTresMesesCent: big(j.mediana_tres_meses_cent), subtotal: j.subtotal === true, signo: num(j.signo) === -1 ? -1 : 1 };
}

export function insumosMensualDeJson(j: J): InsumosMensual {
  const cs = j.costos_sistema as J | null | undefined;
  return {
    ...insumosSemanalDeJson(j), mes: txt(j.mes), mesAnterior: arr(j.pedidos_anterior).map(pedido), resultados: arr(j.resultados).map(renglon), utilidadNetaCent: big(j.utilidad_neta_cent),
    ...(cs ? { costosSistema: { cargoSociedadCent: big(cs.cargo_sociedad_cent), comoSeriaCent: big(cs.como_seria_cent), comoDeberiaSerCent: big(cs.como_deberia_cent), bolsilloJavierCent: big(cs.bolsillo_javier_cent), reembolsadoCent: big(cs.reembolsado_cent), pendienteCent: big(cs.pendiente_cent) } } : {}),
    ventasMensualesCent: bigArr(j.ventas_mensuales_cent), clienteSabor: arr(j.cliente_sabor).map((c) => ({ cliente: txt(c.cliente), sabor: txt(c.sabor), piezas: num(c.piezas) })),
    rankSemanalClientes: arr(j.rank_semanal_clientes).map((r) => ({ cliente: txt(r.cliente), rank: ((r.rank as unknown[]) ?? []).map(num) })), dsoDias: num(j.dso_dias), tendenciaCarteraBp: bigArr(j.tendencia_cartera_bp),
  };
}

/** El paquete lleva bigint: para guardarlo como jsonb se escribe como texto. */
export function paqueteAJson(valor: unknown): string {
  return JSON.stringify(valor, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Set ? [...v] : v));
}
