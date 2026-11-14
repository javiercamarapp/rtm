// Esquemas ESTRICTOS de la salida del extractor (zod). Propiedades desconocidas = rechazo. Todos los campos son obligatorios
// (los opcionales van como null) para poder exigir el mismo esquema al proveedor en modo json_schema estricto.
import { z } from 'zod';
import { MAX_ACCIONES, MAX_LINEAS, MAX_LINEAS_CONTEO, TIPOS_CONSULTA, TIPOS_GASTO, type RespuestaExtractor } from '@/dominio/agente/intenciones';

const texto = (max: number) => z.string().min(1).max(max);
const textoONulo = (max: number) => z.string().min(1).max(max).nullable();
const piezas = z.number().int().min(1).max(2000);
const monto = z.number().int().min(1).max(100_000_000);
const quienPaga = z.enum(['angelo', 'javier', 'sociedad']);
const cita = texto(120);

const lineaCompra = z.strictObject({
  modelo_texto: texto(60),
  sabor_texto: textoONulo(40),
  piezas,
});

const lineaPedido = z.strictObject({
  modelo_texto: texto(60),
  sabor_texto: textoONulo(40),
  piezas,
  precio_texto: textoONulo(20),
  fuente_cita: cita,
});

export const EsquemaIntencion = z.discriminatedUnion('tipo', [
  z.strictObject({
    tipo: z.literal('pedido'),
    cliente_texto: texto(60),
    destino_texto: textoONulo(40),
    lineas: z.array(lineaPedido).min(1).max(MAX_LINEAS),
    envio_cobrado_centavos: z.number().int().min(0).max(200_000).nullable(),
    plazo_texto: textoONulo(60).optional(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('pago'),
    cliente_texto: texto(60),
    monto_centavos: monto,
    cuenta_destino_texto: textoONulo(40),
    pedido_folio: textoONulo(20),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('pago_proveedor'),
    proveedor_texto: texto(40),
    monto_centavos: monto,
    pagado_por: quienPaga,
    cliente_texto: textoONulo(60),
    intencion: z.enum(['capital', 'reembolso']).nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('gasto'),
    gasto: z.enum(TIPOS_GASTO),
    monto_centavos: monto,
    pagado_por: quienPaga,
    descripcion: textoONulo(100),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('aportacion'),
    socio: z.enum(['angelo', 'javier']),
    monto_centavos: monto,
    motivo: textoONulo(100),
    intencion: z.enum(['capital', 'reembolso']).nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('reembolso_socio'),
    socio: z.enum(['angelo', 'javier']),
    monto_centavos: monto,
    via: z.enum(['transferencia', 'efectivo']).nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('retiro_utilidad'),
    socio: z.enum(['angelo', 'javier']),
    monto_centavos: monto,
    via: z.enum(['transferencia', 'efectivo']).nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('devolucion'),
    cliente_texto: texto(60),
    pedido_folio: textoONulo(20),
    lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS),
    destino: z.enum(['inventario', 'merma']).nullable(),
    motivo: textoONulo(100),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('paquete_perdido'),
    pedido_folio: textoONulo(20),
    cliente_texto: textoONulo(60),
    incidente: z.enum(['perdido', 'danado']),
    detalle: textoONulo(100),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('compra'),
    proveedor_texto: texto(40),
    lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS),
    guia_centavos: z.number().int().min(0).max(1_000_000).nullable(),
    pagado_por: quienPaga.nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('orden_compra'),
    proveedor_texto: texto(40),
    lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS),
    aplicar_saldo: z.boolean(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('toma_omar'),
    lineas: z.array(z.strictObject({ modelo_texto: texto(60), sabor_texto: textoONulo(40), piezas: z.number().int().min(1).max(200) })).min(1).max(MAX_LINEAS),
    fuente_cita: cita,
  }),
  z.strictObject({ tipo: z.literal('pedido_envio'), pedido_folio: textoONulo(20), estado: z.enum(['enviado', 'entregado']), paqueteria_texto: textoONulo(40), guia_texto: textoONulo(40), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('pedido_cancelar'), pedido_folio: textoONulo(20), motivo: textoONulo(100), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('compra_recepcion'), compra_folio: textoONulo(20), lineas: z.array(lineaCompra).max(MAX_LINEAS), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('compra_estado'), compra_folio: textoONulo(20), estado: z.enum(['enviada', 'llego_merida']), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('compra_aprobar'), compra_folio: textoONulo(20), fuente_cita: cita }),
  z.strictObject({
    tipo: z.literal('gasto_servicio'),
    servicio_texto: texto(40),
    monto_usd_centavos: monto.nullable(),
    monto_mxn_centavos: monto.nullable(),
    tipo_cambio_micro: z.number().int().min(1_000_000).max(100_000_000).nullable(),
    pagado_por: quienPaga,
    fuente_cita: cita,
  }),
  z.strictObject({ tipo: z.literal('merma'), modelo_texto: texto(60), sabor_texto: textoONulo(40), piezas, motivo: textoONulo(100), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('conteo'), lineas: z.array(z.strictObject({ modelo_texto: texto(60), sabor_texto: textoONulo(40), piezas: z.number().int().min(0).max(5000) })).min(1).max(MAX_LINEAS_CONTEO), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('cliente_alta'), nombre: texto(60), fuente_cita: cita }),
  z.strictObject({ tipo: z.literal('cliente_precio'), cliente_texto: texto(60), modelo_texto: texto(60), precio_centavos: monto, fuente_cita: cita }),
  z.strictObject({
    tipo: z.literal('acta_propuesta'),
    mes: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
    retira_angelo_centavos: monto.nullable(),
    retira_javier_centavos: monto.nullable(),
    reinvierte_angelo_centavos: monto.nullable(),
    reinvierte_javier_centavos: monto.nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({ tipo: z.literal('acta_firma'), acta_folio: textoONulo(20), fuente_cita: cita }),
  z.strictObject({
    tipo: z.literal('lote_historico'),
    etiqueta: textoONulo(60),
    total_dictado_centavos: monto.nullable(),
    renglones: z
      .array(
        z.strictObject({
          tipo: z.enum(['gasto', 'cobro', 'aportacion', 'reembolso', 'retiro']),
          fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          monto_centavos: monto,
          socio: z.enum(['angelo', 'javier']).nullable(),
          cliente_texto: textoONulo(60),
          cuenta_texto: textoONulo(40),
          concepto: textoONulo(100),
          intencion: z.enum(['capital', 'reembolso']).nullable(),
          via: z.enum(['transferencia', 'efectivo']).nullable(),
        }),
      )
      .min(1)
      .max(60),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('pedido_menudeo'),
    proveedor_origen: z.enum(['karen_directo', 'karen_via_isaac', 'isaac_directo']).nullable(),
    lineas: z.array(lineaCompra).min(1).max(MAX_LINEAS),
    cuando_texto: textoONulo(60),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('pago_pedido_menudeo'),
    pedido_folio: textoONulo(20),
    monto_centavos: monto.nullable(),
    referencia: textoONulo(120),
    fecha_texto: textoONulo(40),
    metodo: z.enum(['transferencia', 'deposito', 'efectivo']).nullable(),
    via: z.enum(['proveedor', 'sociedad']).nullable(),
    fuente_cita: cita,
  }),
  z.strictObject({
    tipo: z.literal('consulta'),
    consulta: z.enum(TIPOS_CONSULTA),
    modelo_texto: textoONulo(60),
    sabor_texto: textoONulo(40),
    sujeto_texto: textoONulo(60),
    folio: textoONulo(20),
    periodo: z.enum(['hoy', 'ayer', 'semana', 'mes']).nullable(),
  }),
  z.strictObject({ tipo: z.literal('deshacer'), folio: textoONulo(20) }),
  z.strictObject({ tipo: z.literal('aclarar'), pregunta: texto(200) }),
  z.strictObject({ tipo: z.literal('ninguna') }),
]);

export const EsquemaRespuesta = z.strictObject({
  acciones: z.array(EsquemaIntencion).max(MAX_ACCIONES),
  sospecha_inyeccion: z.boolean(),
  baja_certeza: z.boolean(),
});

export type ValidacionRespuesta = { ok: true; valor: RespuestaExtractor } | { ok: false; errores: string[] };

/** Valida la salida cruda del modelo. Cualquier propiedad desconocida, tipo erroneo o rango fuera de lugar la rechaza. */
export function validarRespuesta(crudo: unknown): ValidacionRespuesta {
  const r = EsquemaRespuesta.safeParse(crudo);
  if (r.success) return { ok: true, valor: r.data };
  return { ok: false, errores: r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`) };
}

/** Restricciones de rango que los proveedores con salida estructurada estricta no aceptan o ignoran; zod las sigue exigiendo al validar la respuesta. */
const RESTRICCIONES_DE_RANGO = new Set(['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern', 'exclusiveMinimum', 'exclusiveMaximum']);

/**
 * Adapta el JSON Schema de zod al dialecto de salida estructurada estricta de los proveedores (medido en la Fase 0a):
 *  - `oneOf` se rechaza (Anthropic via Vertex: "Schema type 'oneOf' is not supported"); las variantes se distinguen por `tipo` (const), asi que `anyOf` es equivalente.
 *  - `$schema` sobra.
 *  - con `sinRangos` se quitan minLength/maxLength/minimum/maximum/minItems/maxItems/pattern; la validacion de rangos queda en zod (validarRespuesta).
 */
export function adaptarEsquemaParaProveedor(esquema: unknown, opciones: { sinRangos?: boolean } = {}): unknown {
  const visitar = (nodo: unknown): unknown => {
    if (Array.isArray(nodo)) return nodo.map(visitar);
    if (nodo === null || typeof nodo !== 'object') return nodo;
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
      if (k === '$schema') continue;
      if (opciones.sinRangos && RESTRICCIONES_DE_RANGO.has(k)) continue;
      salida[k === 'oneOf' ? 'anyOf' : k] = visitar(v);
    }
    return salida;
  };
  return visitar(esquema);
}

/** JSON Schema para response_format estricto del proveedor. */
export function esquemaJsonDeRespuesta(opciones: { sinRangos?: boolean } = {}): unknown {
  return adaptarEsquemaParaProveedor(z.toJSONSchema(EsquemaRespuesta), opciones);
}
