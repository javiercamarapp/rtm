// Esquemas ESTRICTOS (zod) de las intenciones ampliadas. Mismas reglas que esquemas.ts: strictObject (una propiedad desconocida = rechazo), todos los campos obligatorios (los opcionales van null).
// Ningun esquema trae pregunta_id, fechas calculadas, dias ni intereses: eso lo pone el servidor o el codigo, nunca el modelo.
import { z } from 'zod';
import { MAX_LINEAS } from '@/dominio/agente/intenciones';
import { ACCIONES_COBRANZA, CUENTAS_COBRANZA } from '@/dominio/agente/cobranza';
import { CAMPOS_CORRECCION, CLASES_ALIAS, PAQUETERIAS_MODELO } from '@/dominio/agente/intenciones_ampliadas';

const texto = (max: number) => z.string().min(1).max(max);
const textoONulo = (max: number) => z.string().min(1).max(max).nullable();
/** Limite TECNICO de cordura (10^13 centavos = 100 mil millones de pesos), no un tope de negocio: quita el viejo maximo oculto de 1,000,000. */
export const MONTO_TECNICO_MAX = 10_000_000_000_000;
const monto = z.number().int().min(1).max(MONTO_TECNICO_MAX);
const piezas = z.number().int().min(1).max(1_000_000);
const cita = texto(120);
const socio = z.enum(['angelo', 'javier']);
const via = z.enum(['transferencia', 'efectivo']).nullable();
const siNo = z.enum(['si', 'no', 'no_se']);
const folio = textoONulo(20);

const lineaCompra = z.strictObject({ modelo_texto: texto(60), sabor_texto: textoONulo(40), piezas });

export const VARIANTES_AMPLIADAS = [
  z.strictObject({
    tipo: z.literal('pedido_ds'),
    cliente_texto: texto(60),
    proveedor_origen: z.enum(['karen_directo', 'karen_via_isaac', 'isaac_directo']).nullable(),
    lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS),
    forma_pago: z.enum(['contado', 'credito']).nullable(),
    plazo_texto: textoONulo(60),
    envio_cobrado_centavos: z.number().int().min(0).max(MONTO_TECNICO_MAX).nullable(),
    folio_proveedor_texto: textoONulo(30),
    fuente_cita: cita,
  }),
  z.strictObject({ tipo: z.literal('envio_lote'), paqueteria: z.enum(PAQUETERIAS_MODELO).nullable(), folios: z.array(texto(20)).min(1).max(MAX_LINEAS), fuente_cita: cita }),
  z.strictObject({
    tipo: z.literal('guias_lote'),
    paqueteria: z.enum(PAQUETERIAS_MODELO).nullable(),
    guias: z.array(z.strictObject({ pedido_folio: folio, cliente_texto: textoONulo(60), guia_texto: texto(40) })).min(1).max(MAX_LINEAS),
    fuente_cita: cita,
  }),
  z.strictObject({ tipo: z.literal('plazo_acordar'), pedido_folio: folio, cliente_texto: textoONulo(60), plazo_texto: texto(60), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('recargo_credito'), pedido_folio: folio, cliente_texto: textoONulo(60), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('compra_cierre'), compra_folio: folio, motivo: textoONulo(100), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('entrega_fondos'), socio, destino: z.enum(['sociedad', 'isaac', 'karen']), monto_centavos: monto, via, fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('liquidacion_socios'), de_socio: socio, a_socio: socio, monto_centavos: monto, via, fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('retiro_capital'), socio, monto_centavos: monto, via, fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('renta_omar'), monto_centavos: monto, pagado_por: z.enum(['angelo', 'javier', 'sociedad']), via, nota: textoONulo(100), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('obsequio'), lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS), cliente_texto: textoONulo(60), motivo: textoONulo(100), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('sabor_alta'), modelo_texto: texto(60), sabor_texto: texto(40), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('modelo_alta'), marca_texto: textoONulo(40), modelo_texto: texto(60), costo_centavos: monto.nullable(), proveedor_texto: textoONulo(40), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('costo_lista'), proveedor_texto: texto(40), modelo_texto: texto(60), costo_centavos: monto, fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('cobranza_respuesta'), accion: z.enum(ACCIONES_COBRANZA), cliente_texto: texto(60), pedidos_texto: z.array(texto(20)).max(20), monto_texto: textoONulo(40), cuenta: z.enum(CUENTAS_COBRANZA).nullable(), cuando_texto: textoONulo(60), duracion_texto: textoONulo(40), motivo: textoONulo(200), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('alias_ensenar'), clase: z.enum(CLASES_ALIAS), alias_texto: texto(60), oficial_texto: texto(60), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('alias_respuesta'), respuesta: siNo }),
  z.strictObject({ tipo: z.literal('sabor_respuesta'), respuesta: siNo }),
  z.strictObject({ tipo: z.literal('slot_respuesta'), valor_texto: texto(120) }),
  z.strictObject({ tipo: z.literal('correccion'), campo: z.enum(CAMPOS_CORRECCION), valor_texto: texto(120), folio }),
  z.strictObject({ tipo: z.literal('cancelar') }),
] as const;
