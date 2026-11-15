// Filas del catalogo declarativo para las intenciones AMPLIADAS (carril interprete). Decision del dueno (14-nov): SIN tarjeta de confirmacion en ninguna operacion
// (confirmacion 'ninguna'): el bot pregunta lo que falte, registra al tener todos los datos y avisa al grupo; lo reversible se deshace 10 minutos (SQL).
//
// estado 'extraido': el INTERPRETE ya extrae y valida la intencion (esquema estricto, guardia de cifras, banco de pruebas), pero la puerta de ejecucion (agente.ejecutar_ext con su
// tipoHub y las funciones SQL citadas) la construyen otros carriles. Mientras tanto el agente contesta "entendi, aun no esta conectada" y NO registra nada (ver agente.ts).
// Al conectar una puerta, el carril dueno cambia su fila a 'activa'; el test de cobertura de integracion ya verifica solo las 'activa'.
import type { DefIntencion, QuienPuede, Reversa } from './catalogo_intenciones';
import type { IntencionAmpliada } from './intenciones_ampliadas';

type Fila = Pick<DefIntencion, 'descripcion' | 'tipoHub' | 'funcionesSql'> & { reversa?: Reversa; quien?: QuienPuede; hub?: DefIntencion['hub']; estado?: DefIntencion['estado'] };

const F = (f: Fila): DefIntencion => ({ hub: 'agente.ejecutar_ext', confirmacion: 'ninguna', quien: 'socios', reversa: 'ninguna', estado: 'extraido', ...f });

export const CATALOGO_AMPLIADO: Record<IntencionAmpliada['tipo'], DefIntencion> = {
  pedido_ds: F({ descripcion: 'Pedido de dropshipping a un cliente, a contado o a credito con plazo (el proveedor envia; precio, costo, margen e interes los calcula SQL)', tipoHub: 'pedido_ds', funcionesSql: ['operacion.ds_crear_pedido', 'operacion.confirmar_pedido', 'operacion.acordar_plazo'], reversa: 'directa' }),
  envio_lote: F({ descripcion: 'Primer tiempo del envio: varios pedidos salen con una paqueteria del catalogo cerrado (Castores, Pitic, DHL, Estafeta)', tipoHub: 'envio_lote', funcionesSql: ['operacion.enviar_pedido'], reversa: 'software' }),
  guias_lote: F({ descripcion: 'Segundo tiempo del envio: captura en lote de las guias que llegan despues, agrupadas por pedido', tipoHub: 'guias_lote', funcionesSql: ['operacion.enviar_pedido', 'operacion.fijar_costo_guia'], reversa: 'software' }),
  plazo_acordar: F({ descripcion: 'Acordar o cambiar el plazo de pago de un pedido (dias o fecha; lo interpreta el codigo)', tipoHub: 'plazo_acordar', funcionesSql: ['operacion.acordar_plazo'], reversa: 'software' }),
  recargo_credito: F({ descripcion: 'Aplicar el recargo de credito: 10 % simple por semana completa de atraso, calculado por SQL; lo decide el socio dueno del cliente', tipoHub: 'recargo_credito', funcionesSql: ['operacion.registrar_recargo_credito'], reversa: 'software' }),
  compra_cierre: F({ descripcion: 'Cerrar la recepcion de una compra con faltante', tipoHub: 'compra_cierre', funcionesSql: ['operacion.cerrar_recepcion_compra'], reversa: 'software' }),
  entrega_fondos: F({ descripcion: 'Un socio entrega a la sociedad o a un proveedor fondos que cobro en su cuenta', tipoHub: 'entrega_fondos', funcionesSql: ['operacion.registrar_entrega_socio'], reversa: 'directa' , estado: 'activa'}),
  liquidacion_socios: F({ descripcion: 'Liquidacion de un socio al otro', tipoHub: 'liquidacion_socios', funcionesSql: ['operacion.registrar_liquidacion_entre_socios'], reversa: 'directa' , estado: 'activa'}),
  retiro_capital: F({ descripcion: 'Retiro de capital de un socio (lo declara el propio socio)', tipoHub: 'retiro_capital', funcionesSql: ['operacion.proponer_retiro_capital', 'operacion.confirmar_retiro_capital'], reversa: 'ninguna' , estado: 'activa'}),
  renta_omar: F({ descripcion: 'Pago de la renta de Omar (2 pesos por pieza enviada; devengado y exceso los calcula SQL)', tipoHub: 'renta_omar', funcionesSql: ['api.registrar_pago_renta'], reversa: 'directa' , estado: 'activa'}),
  obsequio: F({ descripcion: 'Obsequio de piezas: salen del inventario como merma con motivo obsequio', tipoHub: 'obsequio', funcionesSql: ['operacion.registrar_movimiento'], reversa: 'directa' }),
  sabor_alta: F({ descripcion: 'Alta de un sabor nuevo de un modelo (con revision de parecidos)', tipoHub: 'sabor_alta', funcionesSql: ['catalogo.alta_sabor'] }),
  modelo_alta: F({ descripcion: 'Alta de un modelo nuevo con su marca y costo de lista', tipoHub: 'modelo_alta', funcionesSql: ['catalogo.fijar_costo'] }),
  costo_lista: F({ descripcion: 'Cambio del costo de lista de un modelo con un proveedor', tipoHub: 'costo_lista', funcionesSql: ['catalogo.fijar_costo'] }),
  alias_ensenar: F({ descripcion: 'Propuesta de alias de cliente, sabor, modelo o proveedor; solo se guarda con la confirmacion de un socio', tipoHub: 'alias_ensenar', funcionesSql: ['catalogo.agregar_alias'] }),
  alias_respuesta: F({ descripcion: 'Si o no a la pregunta de guardar un alias (el id de la pregunta lo pone el servidor)', tipoHub: 'alias_respuesta', funcionesSql: ['catalogo.agregar_alias'], reversa: 'software' }),
  sabor_respuesta: F({ descripcion: 'Si o no a la pregunta de si dos sabores son lo mismo (el id de la pregunta lo pone el servidor)', tipoHub: 'sabor_respuesta', funcionesSql: ['catalogo.responder_duplicado', 'catalogo.unificar_sabor'], reversa: 'directa' }),
  slot_respuesta: F({ descripcion: 'Respuesta del socio a la pregunta pendiente del bot (monto, cuenta, plazo, piezas...); la interpreta el parser del dato', tipoHub: null, funcionesSql: [], hub: 'ninguno' }),
  correccion: F({ descripcion: 'Correccion de un dato de lo que el bot acaba de registrar o preguntar (deshacer y re-registrar, nunca editar)', tipoHub: 'correccion', funcionesSql: ['operacion.reversar_evento'], reversa: 'directa' }),
  cancelar: F({ descripcion: 'Cancelar la operacion que quedo a medias (no registra nada)', tipoHub: null, funcionesSql: [], hub: 'ninguno' }),
};
