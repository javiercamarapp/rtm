// Tabla DECLARATIVA del agente: intencion -> funcion SQL existente -> nivel de confirmacion -> quien puede -> si tiene reversa.
// El modelo de IA solo clasifica y extrae campos (esquemas zod en aplicacion/agente/esquemas.ts); nunca genera SQL.
// El agente solo puede llamar lo que esta en esta tabla: cada fila apunta a UNA puerta del esquema `agente` (ejecutar, ejecutar_ext o consulta) con un `tipoHub`
// fijo, y esa puerta llama a las funciones de negocio listadas en `funcionesSql` (probado contra la base en test/integracion).
import type { TipoIntencion } from './intenciones';

export type NivelConfirmacion = 'ninguna' | 'normal' | 'reforzada';
/** directa = "deshacer" la revierte con contramovimiento; software = se corrige en el software; ninguna = no hay reversa. */
export type Reversa = 'directa' | 'software' | 'ninguna';
export type QuienPuede = 'socios' | 'todos';
export type Hub = 'agente.ejecutar' | 'agente.ejecutar_ext' | 'agente.consulta' | 'agente.consulta_ext' | 'ninguno';

export interface DefIntencion {
  descripcion: string;
  hub: Hub;
  tipoHub: string | null;
  funcionesSql: readonly string[];
  confirmacion: NivelConfirmacion;
  quien: QuienPuede;
  reversa: Reversa;
  /** contrato = la base de esta rama aun no trae la funcion (P0461). */
  estado: 'activa' | 'contrato';
}

const A = (d: Partial<DefIntencion> & Pick<DefIntencion, 'descripcion' | 'hub' | 'tipoHub' | 'funcionesSql'>): DefIntencion => ({ confirmacion: 'normal', quien: 'socios', reversa: 'ninguna', estado: 'activa', ...d });
const LECTURA = (descripcion: string, hub: Hub, tipoHub: string | null, funcionesSql: readonly string[], quien: QuienPuede = 'socios'): DefIntencion =>
  ({ descripcion, hub, tipoHub, funcionesSql, confirmacion: 'ninguna', quien, reversa: 'ninguna', estado: 'activa' });

export const CATALOGO_INTENCIONES: Record<TipoIntencion, DefIntencion> = {
  pedido: A({ descripcion: 'Crear un pedido de cliente (precio del tabulador, lo resuelve el servidor)', hub: 'agente.ejecutar_ext', tipoHub: 'pedido_crear', funcionesSql: ['operacion.crear_pedido', 'operacion.confirmar_pedido'], reversa: 'directa' }),
  pedido_envio: A({ descripcion: 'Marcar un pedido enviado o entregado', hub: 'agente.ejecutar_ext', tipoHub: 'pedido_enviar', funcionesSql: ['operacion.enviar_pedido', 'operacion.marcar_entregado'], reversa: 'software' }),
  pedido_cancelar: A({ descripcion: 'Cancelar un pedido con motivo', hub: 'agente.ejecutar_ext', tipoHub: 'pedido_cancelar', funcionesSql: ['operacion.cancelar_pedido'], confirmacion: 'reforzada', reversa: 'ninguna' }),
  pago: A({ descripcion: 'Registrar el cobro de un cliente', hub: 'agente.ejecutar', tipoHub: 'pago_cliente', funcionesSql: ['operacion.registrar_pago'], reversa: 'directa' }),
  pago_proveedor: A({ descripcion: 'Pago a un proveedor (de un socio, de la sociedad o de un cliente)', hub: 'agente.ejecutar', tipoHub: 'pago_proveedor', funcionesSql: ['operacion.pago_proveedor_de_socio', 'operacion.registrar_pago_proveedor_sociedad', 'operacion.registrar_pago'], reversa: 'directa' }),
  gasto: A({ descripcion: 'Gasto pagado por un socio', hub: 'agente.ejecutar', tipoHub: 'gasto', funcionesSql: ['operacion.registrar_gasto_socio'], reversa: 'directa' }),
  gasto_servicio: A({ descripcion: 'Cargo de un servicio del sistema con tipo de cambio (el peso lo calcula la base)', hub: 'agente.ejecutar_ext', tipoHub: 'gasto_servicio', funcionesSql: ['operacion.registrar_gasto_socio', 'costos.techo'], reversa: 'directa' }),
  aportacion: A({ descripcion: 'Deposito de un socio (reembolso salvo que declare capital)', hub: 'agente.ejecutar', tipoHub: 'aportacion', funcionesSql: ['operacion.registrar_aportacion'], reversa: 'directa' }),
  reembolso_socio: A({ descripcion: 'Reembolso a un socio', hub: 'agente.ejecutar', tipoHub: 'pago_a_socio', funcionesSql: ['operacion.registrar_pago_a_socio'], reversa: 'directa' }),
  retiro_utilidad: A({ descripcion: 'Retiro de utilidad ya asignada', hub: 'agente.ejecutar', tipoHub: 'pago_a_socio', funcionesSql: ['operacion.registrar_pago_a_socio'], reversa: 'directa' }),
  devolucion: A({ descripcion: 'Devolucion de un cliente (contrato listo; espera la rama de devoluciones)', hub: 'agente.ejecutar', tipoHub: 'devolucion', funcionesSql: ['operacion.registrar_devolucion_cliente'], estado: 'contrato' }),
  paquete_perdido: A({ descripcion: 'Paquete perdido o danado (contrato listo; espera la rama de paquetes)', hub: 'agente.ejecutar', tipoHub: 'paquete_perdido', funcionesSql: ['operacion.reportar_paquete_salida'], estado: 'contrato' }),
  compra: A({ descripcion: 'Registrar una compra al proveedor (costo de lista, lo pone el servidor)', hub: 'agente.ejecutar_ext', tipoHub: 'compra_crear', funcionesSql: ['operacion.crear_compra', 'operacion.confirmar_compra'], reversa: 'directa' }),
  orden_compra: A({ descripcion: 'Orden de compra en borrador que los socios aprueban', hub: 'agente.ejecutar_ext', tipoHub: 'orden_compra', funcionesSql: ['operacion.crear_compra'], reversa: 'directa' }),
  compra_aprobar: A({ descripcion: 'Aprobar una orden de compra en borrador', hub: 'agente.ejecutar_ext', tipoHub: 'compra_aprobar', funcionesSql: ['operacion.confirmar_compra'], reversa: 'software' }),
  compra_estado: A({ descripcion: 'Paquete de compra en trayecto o llego a Merida', hub: 'agente.ejecutar_ext', tipoHub: 'compra_estado', funcionesSql: ['operacion.marcar_compra_enviada', 'operacion.marcar_llego_merida'], reversa: 'software' }),
  compra_recepcion: A({ descripcion: 'Recepcion total o parcial de una compra', hub: 'agente.ejecutar_ext', tipoHub: 'compra_recepcion', funcionesSql: ['operacion.recibir_compra'], reversa: 'software' }),
  toma_omar: A({ descripcion: 'Toma de Omar (la autorizan los socios con boton)', hub: 'agente.ejecutar', tipoHub: 'toma_omar', funcionesSql: ['operacion.registrar_toma_omar', 'operacion.resolver_toma_omar'], confirmacion: 'ninguna', quien: 'todos', reversa: 'directa' }),
  merma: A({ descripcion: 'Merma de inventario con motivo', hub: 'agente.ejecutar_ext', tipoHub: 'merma', funcionesSql: ['operacion.registrar_movimiento'], confirmacion: 'reforzada', reversa: 'directa' }),
  conteo: A({ descripcion: 'Conteo fisico (ajusta existencias)', hub: 'agente.ejecutar_ext', tipoHub: 'conteo', funcionesSql: ['operacion.abrir_conteo', 'operacion.cerrar_conteo'], confirmacion: 'reforzada', reversa: 'ninguna' }),
  cliente_alta: A({ descripcion: 'Alta de cliente (sin telefonos)', hub: 'agente.ejecutar_ext', tipoHub: 'cliente_alta', funcionesSql: ['catalogo.asegurar_cliente'] }),
  cliente_precio: A({ descripcion: 'Precio de un cliente en el tabulador', hub: 'agente.ejecutar_ext', tipoHub: 'cliente_precio', funcionesSql: ['api.fijar_precio'] }),
  acta_propuesta: A({ descripcion: 'Proponer el acta de corte (retiro y reinversion por socio)', hub: 'agente.ejecutar_ext', tipoHub: 'acta_propuesta', funcionesSql: ['operacion.proponer_cierre_reparto'], confirmacion: 'reforzada' }),
  acta_firma: A({ descripcion: 'Firma personal del acta; el bot nunca firma por un socio', hub: 'agente.ejecutar_ext', tipoHub: 'acta_firma', funcionesSql: ['operacion.firmar_cierre_reparto'], confirmacion: 'reforzada' }),
  lote_historico: A({ descripcion: 'Lote de movimientos con fecha pasada, con vista previa y cuadre por dos vias', hub: 'agente.ejecutar_ext', tipoHub: 'lote_historico', funcionesSql: ['operacion.registrar_gasto_socio', 'operacion.registrar_pago', 'operacion.registrar_aportacion', 'operacion.registrar_pago_a_socio', 'contabilidad.comprobaciones'], confirmacion: 'reforzada', reversa: 'directa' }),
  consulta: LECTURA('Consultas de solo lectura (saldos, utilidad, inventario, contabilidad, pendientes, reporte)', 'agente.consulta', null, ['operacion.saldo_cliente', 'operacion.utilidad_periodo', 'operacion.neto_socio', 'contabilidad.comprobaciones', 'operacion.cobertura'], 'todos'),
  deshacer: A({ descripcion: 'Deshacer el ultimo movimiento propio o un folio', hub: 'ninguno', tipoHub: null, funcionesSql: ['operacion.anular_pago', 'operacion.anular_movimiento_socio', 'operacion.anular_compra', 'operacion.cancelar_pedido', 'operacion.reversar_evento'], confirmacion: 'ninguna', reversa: 'directa' }),
  aclarar: LECTURA('Pregunta de aclaracion', 'ninguno', null, [], 'todos'),
  ninguna: LECTURA('Sin accion', 'ninguno', null, [], 'todos'),
};

/** Las consultas nuevas viven en agente.consulta_ext; las demas en agente.consulta. */
export const CONSULTAS_EXT: ReadonlySet<string> = new Set(['cuadra', 'balance', 'diario', 'cobertura', 'reporte', 'compras', 'pedidos', 'saldos_socios', 'pendientes']);

export function confirmacionDe(t: TipoIntencion): NivelConfirmacion {
  return CATALOGO_INTENCIONES[t].confirmacion;
}
