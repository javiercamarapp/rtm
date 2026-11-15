// El interprete alimenta los slots de la maquina de conversacion (integracion, 16-nov): lo que el extractor ya entendio de un mensaje se convierte en DATOS CRUDOS por slot
// (textos tal como los dijo el socio, centavos tal como los extrajo). La maquina los resuelve contra el catalogo, valida los montos contra la cita y pregunta lo que falte.
// Nada aqui calcula dinero ni resuelve ids; lo que el modelo dejo en null NO se manda (el slot queda vacio y se pregunta).
import type { Intencion } from './intenciones';
import type { OperacionConv } from './slots';

export interface InstruccionConversacion {
  operacion: OperacionConv;
  candidatos: Record<string, unknown>;
}

/** Operaciones que la conversacion registra de punta a punta por el carril de frenos. El resto de las intenciones sigue su camino anterior. */
export const OPERACIONES_POR_CONVERSACION: ReadonlySet<OperacionConv> = new Set<OperacionConv>([
  'pedido_bodega', 'cobro_cliente', 'pago_proveedor', 'pago_redirigido', 'gasto', 'aportacion', 'reembolso', 'retiro', 'conteo', 'alta_cliente', 'alta_sabor', 'alta_modelo',
  // Carril ventas-compras (16-nov)
  'pedido_dropshipping', 'pedido_a_costo', 'compra', 'orden_compra', 'recepcion_compra', 'compra_estado', 'compra_cierre', 'devolucion', 'paquete_perdido', 'envio_lote', 'guias_lote',
  // Carril socios y gastos (16-nov): dinero entre socios, renta de Omar y cargo de servicio.
  'entrega_fondos', 'liquidacion', 'retiro_capital', 'renta_omar', 'gasto_servicio',
]);

function limpiar(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') r[k] = v;
  return r;
}

const lineas = (ls: ReadonlyArray<{ modelo_texto: string; sabor_texto: string | null; piezas: number }>): Array<{ modelo_texto: string; sabor_texto: string | null; piezas: number }> =>
  ls.map((l) => ({ modelo_texto: l.modelo_texto, sabor_texto: l.sabor_texto, piezas: l.piezas }));

/** null = esta intencion no pasa por la conversacion (comandos, consultas, deshacer, intenciones sin puente...). */
export function instruccionDeIntencion(i: Intencion): InstruccionConversacion | null {
  switch (i.tipo) {
    case 'pedido': {
      // Modalidad y plazo: 0 dias = de contado; N dias = a credito con plazo. Sin dato, la maquina pregunta ("¿de contado o a credito?").
      const dias = i.plazo_dias ?? null;
      return {
        operacion: 'pedido_bodega',
        candidatos: limpiar({
          cliente: i.cliente_texto,
          lineas: lineas(i.lineas),
          modalidad: dias === null ? null : dias === 0 ? 'contado' : 'credito',
          plazo: dias !== null && dias > 0 ? `${dias} dias` : i.plazo_texto ?? null,
          // 0 = "sin envio" (valido); null = no lo dijo (se pregunta).
          envio: i.envio_cobrado_centavos,
          destino: i.destino_texto,
        }),
      };
    }
    case 'pago':
      return { operacion: 'cobro_cliente', candidatos: limpiar({ cliente: i.cliente_texto, monto: i.monto_centavos, cuenta: i.cuenta_destino_texto, pedido: i.pedido_folio }) };
    case 'pago_proveedor':
      return {
        operacion: i.cliente_texto === null ? 'pago_proveedor' : 'pago_redirigido',
        candidatos: limpiar({
          proveedor: i.proveedor_texto, monto: i.monto_centavos, cliente: i.cliente_texto,
          ...(i.cliente_texto === null ? { pagado_por: i.pagado_por, intencion: i.pagado_por === 'sociedad' ? null : i.intencion ?? null } : {}),
        }),
      };
    case 'gasto':
      return { operacion: 'gasto', candidatos: limpiar({ tipo_gasto: i.gasto, monto: i.monto_centavos, pagado_por: i.pagado_por, referencia: i.descripcion }) };
    case 'aportacion':
      return { operacion: 'aportacion', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, intencion: i.intencion, motivo: i.motivo }) };
    case 'reembolso_socio':
      return { operacion: 'reembolso', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, via: i.via }) };
    case 'retiro_utilidad':
      return { operacion: 'retiro', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, via: i.via }) };
    case 'entrega_fondos':
      return { operacion: 'entrega_fondos', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, destino: i.destino, via: i.via }) };
    case 'liquidacion_socios':
      return { operacion: 'liquidacion', candidatos: limpiar({ socio: i.de_socio, contraparte: i.a_socio, monto: i.monto_centavos, via: i.via }) };
    case 'retiro_capital':
      return { operacion: 'retiro_capital', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos }) };
    case 'renta_omar':
      return { operacion: 'renta_omar', candidatos: limpiar({ monto: i.monto_centavos, pagado_por: i.pagado_por === 'sociedad' ? null : i.pagado_por, via: i.via }) };
    case 'gasto_servicio':
      return {
        operacion: 'gasto_servicio',
        candidatos: limpiar({
          servicio: i.servicio_texto, moneda: i.monto_usd_centavos !== null ? 'usd' : i.monto_mxn_centavos !== null ? 'mxn' : null, monto: i.monto_usd_centavos ?? i.monto_mxn_centavos,
          pagado_por: i.pagado_por === 'sociedad' ? null : i.pagado_por,
          tipo_cambio: i.tipo_cambio_micro !== null ? String(i.tipo_cambio_micro / 1_000_000) : null,
        }),
      };
    case 'conteo':
      return { operacion: 'conteo', candidatos: limpiar({ lineas: lineas(i.lineas) }) };
    case 'cliente_alta':
      return { operacion: 'alta_cliente', candidatos: limpiar({ nombre: i.nombre }) };
    case 'pedido_ds': {
      const dias = i.plazo_texto ?? null;
      return {
        operacion: 'pedido_dropshipping',
        candidatos: limpiar({
          cliente: i.cliente_texto, origen: i.proveedor_origen, lineas: lineas(i.lineas),
          // Sin forma de pago dicha, la maquina pregunta; el plazo lo interpreta el codigo (plazo_pedido.ts) desde la frase del socio.
          modalidad: i.forma_pago, plazo: i.forma_pago === 'contado' ? null : dias, envio: i.envio_cobrado_centavos, folio_proveedor: i.folio_proveedor_texto,
        }),
      };
    }
    case 'pedido_menudeo':
      return { operacion: 'pedido_a_costo', candidatos: limpiar({ lineas: lineas(i.lineas), origen: i.proveedor_origen, fecha_pago: i.sin_fecha === true ? 'sin fecha' : i.cuando_texto }) };
    case 'compra':
      return { operacion: 'compra', candidatos: limpiar({ proveedor: i.proveedor_texto, lineas: lineas(i.lineas), guia: i.guia_centavos !== null && i.guia_centavos > 0 ? i.guia_centavos : null, guia_pagada_por: i.guia_centavos !== null && i.guia_centavos > 0 ? i.pagado_por : null }) };
    case 'orden_compra':
      return { operacion: 'orden_compra', candidatos: limpiar({ proveedor: i.proveedor_texto, lineas: lineas(i.lineas) }) };
    case 'compra_recepcion':
      return { operacion: 'recepcion_compra', candidatos: limpiar({ folio_compra: i.compra_folio, alcance: i.lineas.length === 0 ? 'total' : 'parcial', lineas: i.lineas.length === 0 ? null : lineas(i.lineas) }) };
    case 'compra_estado':
      return { operacion: 'compra_estado', candidatos: limpiar({ folio_compra: i.compra_folio, estado_compra: i.estado }) };
    case 'compra_cierre':
      return { operacion: 'compra_cierre', candidatos: limpiar({ folio_compra: i.compra_folio, motivo: i.motivo }) };
    case 'devolucion':
      return { operacion: 'devolucion', candidatos: limpiar({ cliente: i.cliente_texto, pedido_folio: i.pedido_folio, lineas: lineas(i.lineas), destino_piezas: i.destino, motivo: i.motivo }) };
    case 'paquete_perdido':
      return { operacion: 'paquete_perdido', candidatos: limpiar({ pedido_folio: i.pedido_folio, incidente: i.incidente, detalle: i.detalle }) };
    case 'envio_lote':
      return { operacion: 'envio_lote', candidatos: limpiar({ folios: i.folios.length > 0 ? i.folios : null, paqueteria: i.paqueteria }) };
    case 'guias_lote':
      return { operacion: 'guias_lote', candidatos: limpiar({ guias: i.guias.length > 0 ? i.guias.map((g) => ({ pedido_folio: g.pedido_folio, cliente_texto: g.cliente_texto, guia_texto: g.guia_texto })) : null, paqueteria: i.paqueteria }) };
    case 'pedido_envio':
      // Un envio sin guia dictada pasa por el catalogo cerrado de paqueterias; con guia dictada conserva su camino anterior (la base valida la paqueteria).
      return i.estado === 'enviado' && i.guia_texto === null ? { operacion: 'envio_lote', candidatos: limpiar({ folios: i.pedido_folio === null ? null : [i.pedido_folio], paqueteria: i.paqueteria_texto }) } : null;
    // Carril aprendizaje y alta asistida: el sabor y el modelo nuevos pasan por la conversacion (el bot pregunta lo que falte; el costo de lista solo si lo dice el socio).
    case 'sabor_alta':
      return { operacion: 'alta_sabor', candidatos: limpiar({ nombre: i.sabor_texto, modelo: i.modelo_texto }) };
    case 'modelo_alta': {
      const prov = i.proveedor_texto === null ? null : /isaac/i.test(i.proveedor_texto) ? 'isaac' : /karen|vapemate/i.test(i.proveedor_texto) ? 'karen' : null;
      return { operacion: 'alta_modelo', candidatos: limpiar({ nombre: i.modelo_texto, marca: i.marca_texto, ...(i.costo_centavos !== null && prov !== null ? { proveedor_costo: prov, costo: i.costo_centavos } : {}) }) };
    }
    default:
      return null;
  }
}
