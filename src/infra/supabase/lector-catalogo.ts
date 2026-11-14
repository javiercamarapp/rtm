// Implementa los puertos del catalogo con las funciones api.* (sesion del usuario, llave publica; nunca la de servicio).
import { z } from 'zod';
import { ErrorAltaNegocio, type AltaCatalogo } from '@/aplicacion/catalogo/alta';
import type { EscritorCatalogo, LectorCatalogo } from '@/aplicacion/catalogo/puertos';
import { crearClienteServidor } from './cliente-servidor';

const cent = z.number().int().transform((n) => BigInt(n));
const centN = cent.nullable();
const estado = z.enum(['disponible', 'sin_disponibilidad']);
const margen = z.object({ proveedor: z.string(), costo_cent: cent, margen_cent: cent, supuesto: z.boolean() }).transform((m) => ({ proveedor: m.proveedor, costoCent: m.costo_cent, margenCent: m.margen_cent, supuesto: m.supuesto }));

const modelo = z.object({
  id: z.number(), marca: z.string(), nombre: z.string(), puffs: z.number().nullable(), estado, estado_desde: z.string(), lista: z.enum(['angelo', 'javier', 'ambas']),
  costos: z.array(z.object({ proveedor: z.enum(['Isaac', 'Karen']), costo_cent: cent, desde: z.string(), supuesto: z.boolean(), es_lista: z.boolean(), motivo: z.string().nullable(), fuente: z.string() })),
  alias: z.array(z.string()),
  precios: z.object({ clientes: z.number(), min_cent: centN, max_cent: centN }),
}).transform((m) => ({
  id: m.id, marca: m.marca, nombre: m.nombre, puffs: m.puffs, estado: m.estado, estadoDesde: m.estado_desde, lista: m.lista, alias: m.alias,
  costos: m.costos.map((c) => ({ proveedor: c.proveedor, costoCent: c.costo_cent, desde: c.desde, supuesto: c.supuesto, esLista: c.es_lista, motivo: c.motivo, fuente: c.fuente })),
  precios: { clientes: m.precios.clientes, minCent: m.precios.min_cent, maxCent: m.precios.max_cent },
}));

const precioDeModelo = z.object({ cliente_id: z.number(), cliente: z.string(), duenio: z.string(), precio_cent: cent, desde: z.string(), origen: z.string(), nota: z.string().nullable(), margenes: z.array(margen) })
  .transform((p) => ({ clienteId: p.cliente_id, cliente: p.cliente, duenio: p.duenio, precioCent: p.precio_cent, desde: p.desde, origen: p.origen, nota: p.nota, margenes: p.margenes }));

const resumen = z.object({
  id: z.number(), nombre: z.string(), duenio: z.enum(['Angelo', 'Javier']), tipo: z.string(), activo: z.boolean(), precios: z.number(),
  alias: z.array(z.object({ alias: z.string(), por_confirmar: z.boolean() })), es_bodega: z.boolean(),
}).transform((c) => ({ id: c.id, nombre: c.nombre, duenio: c.duenio, tipo: c.tipo, activo: c.activo, precios: c.precios, alias: c.alias.map((a) => ({ alias: a.alias, porConfirmar: a.por_confirmar })), esBodega: c.es_bodega }));

const ficha = z.object({
  id: z.number(), nombre: z.string(), duenio: z.string(), tipo: z.string(), activo: z.boolean(), es_bodega: z.boolean(), nota: z.string().nullable().optional(),
  alias: z.array(z.object({ alias: z.string(), por_confirmar: z.boolean(), ambiguo: z.boolean() })),
  destinos: z.array(z.object({ etiqueta: z.string(), zona: z.string() })),
  tabulador: z.array(z.object({ modelo_id: z.number(), modelo: z.string(), estado, precio_cent: cent, desde: z.string(), origen: z.string(), nota: z.string().nullable(), margenes: z.array(margen) })),
  historial: z.array(z.object({ modelo: z.string(), precio_cent: cent, desde: z.string(), hasta: z.string().nullable(), origen: z.string(), vigente: z.boolean(), externo: z.boolean().optional(), nota: z.string().nullable().optional() })),
}).transform((f) => ({
  id: f.id, nombre: f.nombre, duenio: f.duenio, tipo: f.tipo, activo: f.activo, esBodega: f.es_bodega, nota: f.nota ?? null,
  alias: f.alias.map((a) => ({ alias: a.alias, porConfirmar: a.por_confirmar, ambiguo: a.ambiguo })),
  destinos: f.destinos,
  tabulador: f.tabulador.map((t) => ({ modeloId: t.modelo_id, modelo: t.modelo, estado: t.estado, precioCent: t.precio_cent, desde: t.desde, origen: t.origen, nota: t.nota, margenes: t.margenes })),
  historial: f.historial.map((h) => ({ modelo: h.modelo, precioCent: h.precio_cent, desde: h.desde, hasta: h.hasta, origen: h.origen, vigente: h.vigente, externo: h.externo ?? false, nota: h.nota ?? null })),
}));

const existencia = z.object({
  modelos: z.array(z.object({ modelo_id: z.number(), marca: z.string(), modelo: z.string(), estado, piezas: z.number().nullable(), valor_cent: centN, costo_prom_cent: centN, ultimo_movimiento: z.string().nullable() })),
  sabores: z.array(z.object({ sku_id: z.number(), modelo_id: z.number(), sabor: z.string(), ubicacion: z.string(), ubicacion_codigo: z.string(), piezas: z.number() })),
}).transform((e) => ({
  modelos: e.modelos.map((m) => ({ modeloId: m.modelo_id, marca: m.marca, modelo: m.modelo, estado: m.estado, piezas: m.piezas, valorCent: m.valor_cent, costoPromCent: m.costo_prom_cent, ultimoMovimiento: m.ultimo_movimiento })),
  sabores: e.sabores.map((s) => ({ skuId: s.sku_id, modeloId: s.modelo_id, sabor: s.sabor, ubicacion: s.ubicacion, ubicacionCodigo: s.ubicacion_codigo, piezas: s.piezas })),
}));

export const explicacion = z.object({
  cifra: z.string(), titulo: z.string(), unidad: z.enum(['pz', 'mxn', 'ident']), valor: z.number().nullable(),
  // api.explicar_historial omite la clave sin segunda via; si alguna version la mandara con valores nulos, se lee como "sin comprobacion" en vez de romper la pantalla.
  comprobacion: z.object({ via1: z.string(), via1_valor: z.number().nullable(), via2: z.string(), via2_valor: z.number().nullable(), cuadra: z.boolean().nullable(), diferencia: z.number().nullish() }).nullish(),
  fuente: z.string().nullish(),
  // Ficha del panel (migracion 20261115200000): todo opcional; una base sin la migracion sigue funcionando.
  corte: z.object({ fecha: z.string(), hora: z.string() }).nullish(),
  historial: z.array(z.object({ periodo: z.string(), fecha: z.string(), valor_cent: cent })).optional(),
  cuentas: z.array(z.object({ codigo: z.string(), nombre: z.string(), tipo: z.string(), naturaleza: z.string(), saldo_cent: centN.optional() })).optional(),
  movimientos: z.array(z.object({ hora: z.string(), fecha_neg: z.string(), tipo: z.string(), sabor: z.string(), ubicacion: z.string(), cantidad: z.number(), saldo: z.number(), valor_cent: cent, evento: z.string(), canal: z.string(), mensaje_origen: z.string().nullable(), autor: z.string().nullable() })),
  precio_cent: centN.optional(),
  costos: z.array(z.object({ proveedor: z.string(), costo_cent: cent, desde: z.string(), supuesto: z.boolean(), fuente: z.string(), margen_cent: cent, cuadra: z.boolean() })).optional(),
  renglones: z.array(z.object({ concepto: z.string(), monto_cent: cent, saldo_cent: centN.optional(), hora: z.string().nullable().optional(), fecha_neg: z.string().nullable().optional(), evento: z.string().nullable().optional(),
                              canal: z.string().nullable().optional(), autor: z.string().nullable().optional(), mensaje_origen: z.string().nullable().optional() })).optional(),
}).transform((e) => ({
  cifra: e.cifra, titulo: e.titulo, unidad: e.unidad, valor: e.valor,
  comprobacion: e.comprobacion && e.comprobacion.via1_valor !== null && e.comprobacion.via2_valor !== null && e.comprobacion.cuadra !== null
    ? { via1: e.comprobacion.via1, via1Valor: e.comprobacion.via1_valor, via2: e.comprobacion.via2, via2Valor: e.comprobacion.via2_valor, cuadra: e.comprobacion.cuadra, diferencia: e.comprobacion.diferencia ?? null } : null,
  fuente: e.fuente ?? undefined,
  corte: e.corte ?? null,
  historial: (e.historial ?? []).map((h) => ({ periodo: h.periodo, fecha: h.fecha, valorCent: h.valor_cent })),
  cuentas: (e.cuentas ?? []).map((c) => ({ codigo: c.codigo, nombre: c.nombre, tipo: c.tipo, naturaleza: c.naturaleza, saldoCent: c.saldo_cent ?? null })),
  movimientos: e.movimientos.map((m) => ({ hora: m.hora, fechaNeg: m.fecha_neg, tipo: m.tipo, sabor: m.sabor, ubicacion: m.ubicacion, cantidad: m.cantidad, saldo: m.saldo, valorCent: m.valor_cent, evento: m.evento, canal: m.canal, mensajeOrigen: m.mensaje_origen, autor: m.autor })),
  precioCent: e.precio_cent ?? null,
  costos: (e.costos ?? []).map((c) => ({ proveedor: c.proveedor, costoCent: c.costo_cent, desde: c.desde, supuesto: c.supuesto, fuente: c.fuente, margenCent: c.margen_cent, cuadra: c.cuadra })),
  renglones: (e.renglones ?? []).map((r) => ({ concepto: r.concepto, montoCent: r.monto_cent, saldoCent: r.saldo_cent ?? null, hora: r.hora ?? null, fechaNeg: r.fecha_neg ?? null, evento: r.evento ?? null, canal: r.canal ?? null, autor: r.autor ?? null, mensajeOrigen: r.mensaje_origen ?? null })),
}));

export async function llamar<T>(fn: string, args: Record<string, unknown>, esquema: z.ZodType<T, unknown>): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return esquema.parse(data);
}

export function lectorCatalogoSupabase(): LectorCatalogo {
  return {
    modelos: () => llamar('catalogo_modelos', {}, z.array(modelo)),
    preciosDeModelo: (id) => llamar('catalogo_modelo_precios', { p_modelo_id: id }, z.array(precioDeModelo)),
    clientes: () => llamar('clientes_lista', {}, z.array(resumen)),
    ficha: (id) => llamar('cliente_ficha', { p_cliente_id: id }, ficha.nullable()),
    existencia: () => llamar('inventario_existencia', {}, existencia),
    explicar: (cifra) => llamar('explicar_cifra', { p_cifra: cifra }, explicacion),
  };
}

export function escritorCatalogoSupabase(): EscritorCatalogo {
  return {
    async fijarDisponibilidad(claveIdem, modeloId, estadoNuevo) {
      const sb = await crearClienteServidor();
      const { error } = await sb.rpc('fijar_disponibilidad', { p_clave_idem: claveIdem, p_modelo_id: modeloId, p_estado: estadoNuevo });
      if (error) throw new Error(`fijar_disponibilidad: ${error.message}`);
    },
  };
}

// ---- Alta y edicion (clientes, precios, costos) ----
// Estas funciones api.* AUN NO existen en el esquema: su firma exacta esta en docs/pendiente-sql-alta.md.
// Mientras no se instalen, el adaptador responde NO_INSTALADA con un mensaje claro en lugar de un error tecnico.
const NO_INSTALADA = 'Esta función todavía no está instalada en la base (ver docs/pendiente-sql-alta.md). Pide a quien administra la base que la agregue.';

async function escribir<T>(fn: string, args: Record<string, unknown>, esquema: z.ZodType<T, unknown>): Promise<T> {
  const sb = await crearClienteServidor();
  const { data, error } = await sb.rpc(fn, args);
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new ErrorAltaNegocio(NO_INSTALADA, 'NO_INSTALADA');
    throw new ErrorAltaNegocio(error.message, error.code ?? null);
  }
  return esquema.parse(data);
}

const costoHistorico = z.object({
  proveedor: z.enum(['Isaac', 'Karen']), costo_cent: cent, desde: z.string(), hasta: z.string().nullable(), fuente: z.string(), es_lista: z.boolean(), motivo: z.string().nullable(), supuesto: z.boolean(), vigente: z.boolean(),
}).transform((c) => ({ proveedor: c.proveedor, costoCent: c.costo_cent, desde: c.desde, hasta: c.hasta, fuente: c.fuente, esLista: c.es_lista, motivo: c.motivo, supuesto: c.supuesto, vigente: c.vigente }));

export function altaCatalogoSupabase(): AltaCatalogo {
  return {
    async crearCliente(clave, d) {
      const r = await escribir('crear_cliente', { p_clave_idem: clave, p_nombre: d.nombre, p_tipo: d.tipo, p_nota: d.nota }, z.object({ cliente_id: z.number(), creado: z.boolean() }));
      return { clienteId: r.cliente_id, creado: r.creado };
    },
    async editarCliente(clave, id, d) {
      const r = await escribir('editar_cliente', { p_clave_idem: clave, p_cliente_id: id, p_nombre: d.nombre, p_tipo: d.tipo, p_nota: d.nota, p_activo: d.activo }, z.object({ cliente_id: z.number() }));
      return { clienteId: r.cliente_id };
    },
    async fijarPrecio(clave, d) {
      const r = await escribir('fijar_precio', { p_clave_idem: clave, p_cliente_id: d.clienteId, p_modelo_id: d.modeloId, p_precio_cent: Number(d.precioCent), p_desde: d.desde, p_origen: d.origen, p_nota: d.nota }, z.object({ precio_id: z.number(), sin_cambio: z.boolean() }));
      return { precioId: r.precio_id, sinCambio: r.sin_cambio };
    },
    async fijarCosto(clave, d) {
      const r = await escribir('fijar_costo', { p_clave_idem: clave, p_proveedor: d.proveedor, p_modelo_id: d.modeloId, p_costo_cent: Number(d.costoCent), p_desde: d.desde, p_fuente: d.fuente, p_motivo: d.motivo, p_supuesto: d.supuesto, p_es_lista: d.esLista }, z.object({ costo_id: z.number(), sin_cambio: z.boolean() }));
      return { costoId: r.costo_id, sinCambio: r.sin_cambio };
    },
    historialCostos: (modeloId) => escribir('costo_historial', { p_modelo_id: modeloId }, z.array(costoHistorico)),
  };
}
