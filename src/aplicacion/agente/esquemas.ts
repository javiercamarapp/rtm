// Esquemas ESTRICTOS de la salida del extractor (zod). Propiedades desconocidas = rechazo. Todos los campos son obligatorios
// (los opcionales van como null) para poder exigir el mismo esquema al proveedor en modo json_schema estricto.
import { z } from 'zod';
import { MAX_ACCIONES, MAX_LINEAS, TIPOS_CONSULTA, TIPOS_GASTO, type RespuestaExtractor } from '@/dominio/agente/intenciones';

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

/** JSON Schema para response_format estricto del proveedor. */
export function esquemaJsonDeRespuesta(): unknown {
  return z.toJSONSchema(EsquemaRespuesta);
}
