// Intenciones AMPLIADAS del agente (carril interprete, 14-nov): todas las operaciones de los machotes que el catalogo base no cubria.
// Igual que el resto del catalogo: el modelo SOLO copia textos y cifras tal como se dijeron y marca lo que falta; nunca calcula ni resuelve ids.
// Lo que no cabe en el esquema del modelo (pregunta_id de una respuesta, fechas, dias, intereses) lo pone el SERVIDOR o el codigo, jamas el modelo.
import type { ILineaCompraTexto, QuienPaga, SocioNombre, ViaPago } from './intenciones';

/** Decision del dueno (14-nov): catalogo CERRADO de paqueterias. 'otra' = el socio nombro una que no esta en el catalogo (el servidor pide una de las cuatro). */
export const PAQUETERIAS = ['castores', 'pitic', 'dhl', 'estafeta'] as const;
export type Paqueteria = (typeof PAQUETERIAS)[number];
export const PAQUETERIAS_MODELO = [...PAQUETERIAS, 'otra'] as const;
export type PaqueteriaDicha = (typeof PAQUETERIAS_MODELO)[number];

export type OrigenDs = 'karen_directo' | 'karen_via_isaac' | 'isaac_directo';
export type FormaPago = 'contado' | 'credito';

/**
 * Pedido de dropshipping a un CLIENTE (el proveedor envia de su stock; no entra inventario a Merida). Sin destinatario ni telefonos: los datos de entrega se capturan en la web
 * (un destinatario que el socio escriba en el chat se IGNORA; el servidor usa uno ficticio de lista). Precio, costo, margen e interes los calcula SQL.
 */
export interface IPedidoDs {
  tipo: 'pedido_ds';
  cliente_texto: string;
  proveedor_origen: OrigenDs | null;
  lineas: ILineaCompraTexto[];
  /** Lo que el socio dijo con sus palabras: "de contado" o "a credito / fiado". null = no lo dijo (el bot pregunta). */
  forma_pago: FormaPago | null;
  /** Frase del plazo copiada tal cual; los DIAS los calcula plazo_pedido.ts. */
  plazo_texto: string | null;
  envio_cobrado_centavos: number | null;
  /** Folio del proveedor si el socio lo dicta (sus digitos deben estar en el mensaje). */
  folio_proveedor_texto: string | null;
  fuente_cita: string;
}

/** Primer tiempo del envio (decision 6): los pedidos SALEN con una paqueteria; la guia llega despues (guias_lote). */
export interface IEnvioLote {
  tipo: 'envio_lote';
  paqueteria: PaqueteriaDicha | null;
  folios: string[];
  fuente_cita: string;
}

export interface IGuiaRenglon {
  pedido_folio: string | null;
  cliente_texto: string | null;
  guia_texto: string;
}

/** Segundo tiempo: las guias llegan despues y se agrupan POR PEDIDO. */
export interface IGuiasLote {
  tipo: 'guias_lote';
  paqueteria: PaqueteriaDicha | null;
  guias: IGuiaRenglon[];
  fuente_cita: string;
}

/** Cambia el plazo de un pedido ya hecho. Los dias o la fecha los interpreta el codigo. */
export interface IPlazoAcordar {
  tipo: 'plazo_acordar';
  pedido_folio: string | null;
  cliente_texto: string | null;
  plazo_texto: string;
  fuente_cita: string;
}

/** El socio pide aplicar el recargo de credito (10 % simple por semana completa de atraso). El monto y las semanas los calcula SQL; el bot solo lo sugiere y decide el socio dueno del cliente. */
export interface IRecargoCredito {
  tipo: 'recargo_credito';
  pedido_folio: string | null;
  cliente_texto: string | null;
  fuente_cita: string;
}

/** Cierra la recepcion de una compra con faltante (lo que no llego se da por no recibido). */
export interface ICompraCierre {
  tipo: 'compra_cierre';
  compra_folio: string | null;
  motivo: string | null;
  fuente_cita: string;
}

/** Un socio que cobro en su cuenta entrega esos fondos a la sociedad o a un proveedor. */
export interface IEntregaFondos {
  tipo: 'entrega_fondos';
  socio: SocioNombre;
  destino: 'sociedad' | 'isaac' | 'karen';
  monto_centavos: number;
  via: ViaPago | null;
  fuente_cita: string;
}

/** Un socio le liquida al otro. */
export interface ILiquidacionSocios {
  tipo: 'liquidacion_socios';
  de_socio: SocioNombre;
  a_socio: SocioNombre;
  monto_centavos: number;
  via: ViaPago | null;
  fuente_cita: string;
}

/** Retiro de capital de un socio (el capital lo declara el propio socio; nunca a nombre del otro). */
export interface IRetiroCapital {
  tipo: 'retiro_capital';
  socio: SocioNombre;
  monto_centavos: number;
  via: ViaPago | null;
  fuente_cita: string;
}

/** Pago de la renta de Omar (2 pesos por pieza enviada); el devengado y el exceso los calcula SQL. */
export interface IRentaOmar {
  tipo: 'renta_omar';
  monto_centavos: number;
  pagado_por: QuienPaga;
  via: ViaPago | null;
  nota: string | null;
  fuente_cita: string;
}

/** Piezas regaladas: salen del inventario como merma con motivo obsequio. */
export interface IObsequio {
  tipo: 'obsequio';
  lineas: ILineaCompraTexto[];
  cliente_texto: string | null;
  motivo: string | null;
  fuente_cita: string;
}

export interface ISaborAlta {
  tipo: 'sabor_alta';
  modelo_texto: string;
  sabor_texto: string;
  fuente_cita: string;
}

export interface IModeloAlta {
  tipo: 'modelo_alta';
  marca_texto: string | null;
  modelo_texto: string;
  /** Lo dicho tal cual ("140"); el servidor lo valida contra el mensaje. */
  costo_centavos: number | null;
  proveedor_texto: string | null;
  fuente_cita: string;
}

/** Cambia el costo de lista de un modelo con un proveedor. */
export interface ICostoLista {
  tipo: 'costo_lista';
  proveedor_texto: string;
  modelo_texto: string;
  costo_centavos: number;
  fuente_cita: string;
}

export const CLASES_ALIAS = ['cliente', 'sabor', 'modelo', 'proveedor'] as const;
export type ClaseAlias = (typeof CLASES_ALIAS)[number];

/** Propuesta de alias ("Memo es Guillermo Torres"). Decision 5: aprende DATOS; un alias solo se guarda con la confirmacion de un socio (alias_respuesta). */
export interface IAliasEnsenar {
  tipo: 'alias_ensenar';
  clase: ClaseAlias;
  alias_texto: string;
  oficial_texto: string;
  fuente_cita: string;
}

export type RespuestaSiNo = 'si' | 'no' | 'no_se';

/**
 * Si o no a la pregunta del bot "guardo X como alias de Y?". El id de la pregunta lo toma el SERVIDOR de su memoria (ver respuestas_memoria.ts); el modelo no lo conoce ni lo escribe.
 */
export interface IAliasRespuesta {
  tipo: 'alias_respuesta';
  respuesta: RespuestaSiNo;
}

/**
 * Si o no a la pregunta "X es lo mismo que Y?" (unificacion de sabores). Igual que el alias: el pregunta_id sale de la memoria del servidor, NUNCA del modelo
 * (el esquema estricto rechaza cualquier propiedad `pregunta_id` que el modelo mande).
 */
export interface ISaborRespuesta {
  tipo: 'sabor_respuesta';
  respuesta: RespuestaSiNo;
}

/** El mensaje responde a la pregunta pendiente del bot (monto, cuenta, plazo, cuantas piezas...): se copia lo dicho; el parser del slot lo interpreta. */
export interface ISlotRespuesta {
  tipo: 'slot_respuesta';
  valor_texto: string;
}

export const CAMPOS_CORRECCION = ['cliente', 'modelo', 'sabor', 'piezas', 'monto', 'plazo', 'cuenta', 'fecha', 'proveedor', 'paqueteria', 'otro'] as const;
export type CampoCorreccion = (typeof CAMPOS_CORRECCION)[number];

/** "No, eran 20", "perdon, fue a Karen": corrige un dato de lo que el bot acaba de registrar o de preguntar. El servidor lo aplica como deshacer + re-registrar (nunca edita). */
export interface ICorreccion {
  tipo: 'correccion';
  campo: CampoCorreccion;
  valor_texto: string;
  folio: string | null;
}

/** "Ya no", "olvidalo", "cancela eso": cierra la operacion que quedo a medias (no registra nada). Distinto de pedido_cancelar (un pedido ya hecho). */
export interface ICancelar {
  tipo: 'cancelar';
}

export type IntencionAmpliada =
  | IPedidoDs
  | IEnvioLote
  | IGuiasLote
  | IPlazoAcordar
  | IRecargoCredito
  | ICompraCierre
  | IEntregaFondos
  | ILiquidacionSocios
  | IRetiroCapital
  | IRentaOmar
  | IObsequio
  | ISaborAlta
  | IModeloAlta
  | ICostoLista
  | IAliasEnsenar
  | IAliasRespuesta
  | ISaborRespuesta
  | ISlotRespuesta
  | ICorreccion
  | ICancelar;

/** Intenciones nuevas que escriben en la base (las de respuesta y control no escriben por si solas: cierran una pregunta o una operacion del servidor). */
export const ESCRITURA_AMPLIADA: readonly IntencionAmpliada['tipo'][] = [
  'pedido_ds', 'envio_lote', 'guias_lote', 'plazo_acordar', 'recargo_credito', 'compra_cierre', 'entrega_fondos', 'liquidacion_socios', 'retiro_capital', 'renta_omar', 'obsequio',
  'sabor_alta', 'modelo_alta', 'costo_lista', 'alias_ensenar', 'alias_respuesta', 'sabor_respuesta', 'correccion',
];
