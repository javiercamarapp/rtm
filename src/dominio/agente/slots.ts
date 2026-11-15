// Definicion DECLARATIVA de los datos obligatorios (slots) de cada operacion que el bot registra (decision del dueno, 14-nov: el bot pregunta lo que falte hasta cerrar la operacion).
// Espejo SQL: agente.operacion_slot (supabase/migrations/20261116200000_agente_conversacion.sql); la prueba test/unit/agente/conversacion_slots.test.ts verifica que coincidan.
// Los textos de las preguntas salen de MACHOTES-Y-ESQUELETO-RTM (espanol neutro, sin emojis). Nada aqui calcula dinero.
import type { OpcionSlot } from './slots_tipos';
import { OPERACIONES_SOCIOS, OPERACIONES_SOCIOS_CONV } from './slots_socios';

export type { OpcionSlot } from './slots_tipos';

export const OPERACIONES_CONV = [
  'pedido_bodega', 'pedido_dropshipping', 'pedido_a_costo', 'cobro_cliente', 'pago_redirigido', 'pago_proveedor', 'compra', 'recepcion_compra', 'gasto',
  'aportacion', 'deposito', 'reembolso', 'retiro', 'entrega_fondos', 'liquidacion', 'conteo', 'merma', 'obsequio', 'devolucion', 'alta_cliente', 'alta_sabor', 'alta_modelo',
  // Carril ventas-compras (16-nov)
  'orden_compra', 'compra_estado', 'compra_cierre', 'envio_lote', 'guias_lote', 'paquete_perdido',
  ...OPERACIONES_SOCIOS_CONV,
] as const;
export type OperacionConv = (typeof OPERACIONES_CONV)[number];

export type TipoSlot = 'cliente' | 'proveedor' | 'monto' | 'opcion' | 'texto' | 'fecha_pago' | 'plazo' | 'lineas' | 'folio' | 'bandera' | 'folios' | 'guias';

/** Obligatorio solo si el slot `slot` vale alguno de `valores`; sin `valores`, si esta presente. */
export interface CondicionSlot {
  slot: string;
  valores?: readonly string[];
}

export interface DefSlot {
  clave: string;
  tipo: TipoSlot;
  obligatorio: boolean;
  /** Pregunta exacta cuando falta (machotes). Con opciones cerradas se acompana de botones. */
  pregunta: string;
  opciones?: readonly OpcionSlot[];
  si?: CondicionSlot;
  /** Como lo llama el socio al corregir ("cambia el monto a ..."). */
  sinonimos?: readonly string[];
  /** Los sabores son obligatorios en cada renglon (pedidos, compras y conteos); en alta de modelo no aplica. */
  saborObligatorio?: boolean;
}

export interface DefOperacion {
  clave: OperacionConv;
  titulo: string;
  slots: readonly DefSlot[];
  /** Aviso que se agrega al mensaje final (por ejemplo, los datos de entrega no pasan por Telegram). */
  avisoFinal?: string;
}

const PAQUETERIAS_OPC: readonly OpcionSlot[] = [{ valor: 'Castores', texto: 'Castores' }, { valor: 'Pitic', texto: 'Pitic' }, { valor: 'DHL', texto: 'DHL' }, { valor: 'Estafeta', texto: 'Estafeta' }];
const MONTO = '¿De cuánto fue? Escribe la cifra completa, por ejemplo 12,500.';
const SOCIOS: readonly OpcionSlot[] = [{ valor: 'angelo', texto: 'Angelo' }, { valor: 'javier', texto: 'Javier' }];
const VIA: readonly OpcionSlot[] = [{ valor: 'transferencia', texto: 'Transferencia' }, { valor: 'efectivo', texto: 'Efectivo' }];
const MODALIDAD: readonly OpcionSlot[] = [{ valor: 'contado', texto: 'De contado' }, { valor: 'credito', texto: 'A crédito' }];
const INTENCION: readonly OpcionSlot[] = [{ valor: 'reembolso', texto: 'Reembolso' }, { valor: 'capital', texto: 'Capital para invertir' }];
const PAGADO_POR: readonly OpcionSlot[] = [{ valor: 'angelo', texto: 'Angelo' }, { valor: 'javier', texto: 'Javier' }, { valor: 'sociedad', texto: 'La sociedad (caja)' }];

const cliente = (pregunta = '¿De qué cliente es? Escribe el nombre completo.'): DefSlot => ({ clave: 'cliente', tipo: 'cliente', obligatorio: true, pregunta, sinonimos: ['cliente'] });
const proveedor = (): DefSlot => ({ clave: 'proveedor', tipo: 'proveedor', obligatorio: true, pregunta: '¿Con qué proveedor es: Isaac o Karen (Vapemate)?', opciones: [{ valor: 'isaac', texto: 'Isaac' }, { valor: 'karen', texto: 'Karen' }], sinonimos: ['proveedor'] });
const lineas = (pregunta = '¿Qué modelo, sabor y cuántas piezas? Por ejemplo: nexa mango 24.', saborObligatorio = true): DefSlot => ({ clave: 'lineas', tipo: 'lineas', obligatorio: true, pregunta, saborObligatorio, sinonimos: ['piezas', 'cantidad', 'renglones', 'modelo', 'sabor', 'pedido'] });
const monto = (si?: CondicionSlot): DefSlot => ({ clave: 'monto', tipo: 'monto', obligatorio: true, pregunta: MONTO, sinonimos: ['monto', 'importe', 'cantidad de dinero', 'total'], ...(si ? { si } : {}) });
const socio = (pregunta: string): DefSlot => ({ clave: 'socio', tipo: 'opcion', obligatorio: true, pregunta, opciones: SOCIOS, sinonimos: ['socio'] });
const via = (): DefSlot => ({ clave: 'via', tipo: 'opcion', obligatorio: true, pregunta: '¿Fue por transferencia o en efectivo?', opciones: VIA, sinonimos: ['via', 'forma de pago'] });
const modalidad = (): DefSlot => ({ clave: 'modalidad', tipo: 'opcion', obligatorio: true, pregunta: '¿Es de contado o a crédito?', opciones: MODALIDAD, sinonimos: ['modalidad', 'condicion'] });
const plazo = (): DefSlot => ({
  clave: 'plazo', tipo: 'plazo', obligatorio: true, si: { slot: 'modalidad', valores: ['credito'] },
  pregunta: '¿A cuántos días o semanas paga? También puedes escribir la fecha, por ejemplo «el viernes» o «20 de noviembre».', sinonimos: ['plazo', 'dias', 'semanas', 'fecha de pago'],
});
const envio = (): DefSlot => ({ clave: 'envio', tipo: 'monto', obligatorio: true, pregunta: '¿Cobras envío al cliente? Escribe el monto o «sin envío».', opciones: [{ valor: '0', texto: 'Sin envío' }], sinonimos: ['envio', 'flete'] });
const motivo = (pregunta: string): DefSlot => ({ clave: 'motivo', tipo: 'texto', obligatorio: true, pregunta, sinonimos: ['motivo', 'razon'] });
const nombre = (pregunta: string): DefSlot => ({ clave: 'nombre', tipo: 'texto', obligatorio: true, pregunta, sinonimos: ['nombre'] });
const banderas = (...claves: string[]): DefSlot[] => claves.map((clave) => ({ clave, tipo: 'bandera', obligatorio: false, pregunta: '' }));
const opcional = (clave: string, pregunta: string, tipo: TipoSlot = 'texto'): DefSlot => ({ clave, tipo, obligatorio: false, pregunta });

export const OPERACIONES: Readonly<Record<OperacionConv, DefOperacion>> = {
  ...OPERACIONES_SOCIOS,
  pedido_bodega: {
    clave: 'pedido_bodega', titulo: 'Pedido de bodega',
    slots: [cliente(), lineas(), modalidad(), plazo(), envio(),
      { clave: 'destino', tipo: 'texto', obligatorio: true, si: { slot: 'destino_varios', valores: ['true'] }, pregunta: '¿A cuál destino va?', sinonimos: ['destino'] }, ...banderas('destino_varios')],
  },
  pedido_dropshipping: {
    clave: 'pedido_dropshipping', titulo: 'Pedido de dropshipping',
    slots: [cliente(), { clave: 'origen', tipo: 'opcion', obligatorio: true, pregunta: '¿Lo surte Karen directo, Karen vía Isaac o Isaac directo?',
      opciones: [{ valor: 'karen_directo', texto: 'Karen directo' }, { valor: 'karen_via_isaac', texto: 'Karen vía Isaac' }, { valor: 'isaac_directo', texto: 'Isaac directo' }], sinonimos: ['origen', 'proveedor'] },
    lineas(), modalidad(), plazo(), envio(), opcional('folio_proveedor', '¿Ya tienes el folio del proveedor? Si no, escribe «luego».')],
    avisoFinal: 'Los datos de entrega (nombre, dirección, teléfono) no se escriben en Telegram: captúralos en la web.',
  },
  pedido_a_costo: {
    clave: 'pedido_a_costo', titulo: 'Pedido a costo (menudeo)',
    slots: [lineas(), { clave: 'origen', tipo: 'opcion', obligatorio: true, pregunta: '¿Lo surte Karen o Isaac?', opciones: [{ valor: 'karen_directo', texto: 'Karen' }, { valor: 'isaac_directo', texto: 'Isaac' }], sinonimos: ['origen', 'proveedor'] },
      { clave: 'fecha_pago', tipo: 'fecha_pago', obligatorio: true, pregunta: '¿Cuándo pagas este pedido? Escribe la fecha y la hora, por ejemplo «el viernes», «mañana a las 5 de la tarde» o «20 de noviembre». Si todavía no hay fecha, escribe «sin fecha». (Hora de Mérida.)', sinonimos: ['fecha de pago', 'fecha', 'cuando paga'] }],
  },
  cobro_cliente: {
    clave: 'cobro_cliente', titulo: 'Cobro de cliente',
    slots: [cliente(), monto(), { clave: 'cuenta', tipo: 'opcion', obligatorio: true, pregunta: '¿A qué cuenta entró el pago: Angelo, Javier, Isaac, Karen o efectivo?',
      opciones: [{ valor: 'angelo', texto: 'Angelo' }, { valor: 'javier', texto: 'Javier' }, { valor: 'isaac', texto: 'Isaac' }, { valor: 'karen', texto: 'Karen' }, { valor: 'efectivo', texto: 'Efectivo' }], sinonimos: ['cuenta', 'forma de pago'] },
    { clave: 'pedido', tipo: 'texto', obligatorio: true, si: { slot: 'pedido_varios', valores: ['true'] }, pregunta: '¿A qué pedido lo aplico?', sinonimos: ['pedido', 'folio'] },
    { clave: 'confirma_exceso', tipo: 'opcion', obligatorio: true, si: { slot: 'exceso', valores: ['true'] }, pregunta: 'El monto es mayor que lo que debe el cliente. ¿Es un anticipo o corrijo el monto?',
      opciones: [{ valor: 'anticipo', texto: 'Es un anticipo' }, { valor: 'corregir', texto: 'Corregir el monto' }] },
    ...banderas('pedido_varios', 'exceso'), opcional('fecha', '¿Qué día fue?', 'fecha_pago'), opcional('comprobante', '¿Tienes el comprobante?')],
  },
  pago_redirigido: {
    clave: 'pago_redirigido', titulo: 'Pago de cliente al proveedor',
    slots: [cliente(), proveedor(), monto(), { clave: 'pedido', tipo: 'texto', obligatorio: true, si: { slot: 'pedido_varios', valores: ['true'] }, pregunta: '¿A qué pedido lo aplico?', sinonimos: ['pedido', 'folio'] },
      ...banderas('pedido_varios'), opcional('comprobante', '¿Tienes el comprobante?')],
  },
  pago_proveedor: {
    clave: 'pago_proveedor', titulo: 'Pago a proveedor',
    slots: [proveedor(), monto(), { clave: 'pagado_por', tipo: 'opcion', obligatorio: true, pregunta: '¿Pagó Angelo, Javier o la sociedad (caja)?', opciones: PAGADO_POR, sinonimos: ['pagado por', 'quien pago'] },
      { clave: 'intencion', tipo: 'opcion', obligatorio: true, si: { slot: 'pagado_por', valores: ['angelo', 'javier'] }, pregunta: '¿Es dinero que quieres invertir como capital o es un reembolso?', opciones: INTENCION, sinonimos: ['intencion', 'capital'] }],
  },
  compra: {
    clave: 'compra', titulo: 'Compra a proveedor',
    slots: [proveedor(), lineas(), opcional('guia', '¿Hay guía o flete? ¿De cuánto?', 'monto'),
      { clave: 'guia_pagada_por', tipo: 'opcion', obligatorio: true, si: { slot: 'guia' }, pregunta: '¿Quién pagó la guía: Angelo, Javier o la sociedad?', opciones: PAGADO_POR }],
  },
  recepcion_compra: {
    clave: 'recepcion_compra', titulo: 'Recepción de compra',
    slots: [{ clave: 'folio_compra', tipo: 'folio', obligatorio: true, pregunta: '¿De qué compra es? Escribe el folio (por ejemplo C-0001).', sinonimos: ['folio', 'compra'] },
      { clave: 'alcance', tipo: 'opcion', obligatorio: true, pregunta: '¿Llegó todo o solo una parte?', opciones: [{ valor: 'total', texto: 'Llegó todo' }, { valor: 'parcial', texto: 'Solo una parte' }] },
      { ...lineas('¿Cuántas piezas de cada sabor llegaron? Por ejemplo: nexa mango 24.'), obligatorio: true, si: { slot: 'alcance', valores: ['parcial'] } }],
  },
  gasto: {
    clave: 'gasto', titulo: 'Gasto',
    slots: [{ clave: 'tipo_gasto', tipo: 'opcion', obligatorio: true, pregunta: '¿Qué tipo de gasto es: guía, envío, Uber, comisión de terminal, servicio u otro?',
      opciones: [{ valor: 'guia', texto: 'Guía' }, { valor: 'envio', texto: 'Envío' }, { valor: 'uber', texto: 'Uber' }, { valor: 'comision_terminal', texto: 'Comisión de terminal' }, { valor: 'servicio', texto: 'Servicio' }, { valor: 'otro', texto: 'Otro' }], sinonimos: ['tipo', 'tipo de gasto'] },
    monto(), { clave: 'pagado_por', tipo: 'opcion', obligatorio: true, pregunta: '¿Quién pagó el gasto: Angelo, Javier o la sociedad (caja)?', opciones: PAGADO_POR, sinonimos: ['pagado por', 'quien pago'] },
    opcional('referencia', '¿Es de algún pedido o compra? Escribe el folio o «ninguno».'), opcional('comprobante', '¿Tienes el comprobante?')],
  },
  aportacion: {
    clave: 'aportacion', titulo: 'Aportación de un socio',
    slots: [socio('¿Quién puso el dinero, Angelo o Javier?'), monto(), { clave: 'intencion', tipo: 'opcion', obligatorio: true, pregunta: '¿Lo pones como capital para invertir o es un reembolso?', opciones: INTENCION, sinonimos: ['intencion', 'capital'] }, opcional('motivo', '¿Para qué fue?')],
  },
  deposito: {
    clave: 'deposito', titulo: 'Depósito de un socio',
    slots: [socio('¿Quién depositó, Angelo o Javier?'), monto(), { clave: 'intencion', tipo: 'opcion', obligatorio: true, pregunta: '¿Lo pones como capital para invertir o es un reembolso?', opciones: INTENCION, sinonimos: ['intencion', 'capital'] }, opcional('motivo', '¿Para qué fue?')],
  },
  reembolso: { clave: 'reembolso', titulo: 'Reembolso a un socio', slots: [socio('¿A quién le pagas, Angelo o Javier?'), monto(), via()] },
  retiro: { clave: 'retiro', titulo: 'Retiro de utilidad', slots: [socio('¿Quién retira, Angelo o Javier?'), monto(), via()] },
  entrega_fondos: {
    clave: 'entrega_fondos', titulo: 'Entrega de fondos',
    slots: [socio('¿Quién entrega, Angelo o Javier?'), monto(), { clave: 'destino', tipo: 'opcion', obligatorio: true, pregunta: '¿A la sociedad, a Isaac o a Karen?', opciones: [{ valor: 'sociedad', texto: 'A la sociedad' }, { valor: 'isaac', texto: 'A Isaac' }, { valor: 'karen', texto: 'A Karen' }], sinonimos: ['destino', 'a quien'] }, via()],
  },
  liquidacion: {
    clave: 'liquidacion', titulo: 'Liquidación entre socios',
    slots: [socio('¿Quién paga, Angelo o Javier?'), { clave: 'contraparte', tipo: 'opcion', obligatorio: true, pregunta: '¿A quién le paga, a Angelo o a Javier?', opciones: SOCIOS, sinonimos: ['contraparte', 'a quien'] }, monto(), via()],
  },
  conteo: { clave: 'conteo', titulo: 'Conteo físico', slots: [lineas('¿Qué modelo, sabor y cuántas piezas contaste? Por ejemplo: nexa mango 24.'), opcional('fecha', '¿Qué día fue?', 'fecha_pago')] },
  merma: { clave: 'merma', titulo: 'Merma', slots: [lineas('¿Qué modelo, sabor y cuántas piezas?'), motivo('¿Cuál es el motivo de la merma?')] },
  obsequio: { clave: 'obsequio', titulo: 'Obsequio', slots: [lineas('¿Qué modelo, sabor y cuántas piezas?'), motivo('¿Para quién o por qué es el obsequio?')] },
  devolucion: {
    clave: 'devolucion', titulo: 'Devolución de un cliente',
    slots: [cliente(), { clave: 'pedido_folio', tipo: 'folio', obligatorio: true, pregunta: '¿De qué pedido es la devolución? Escribe el folio.', sinonimos: ['pedido', 'folio'] },
      lineas('¿Qué modelo, sabor y cuántas piezas devolvió?'),
      { clave: 'destino_piezas', tipo: 'opcion', obligatorio: true, pregunta: '¿Las piezas regresan al inventario o van a merma?', opciones: [{ valor: 'inventario', texto: 'Al inventario' }, { valor: 'merma', texto: 'A merma' }], sinonimos: ['destino'] },
      motivo('¿Cuál fue el motivo de la devolución?')],
  },
  orden_compra: {
    clave: 'orden_compra', titulo: 'Orden de compra (borrador)',
    slots: [proveedor(), lineas()],
  },
  compra_estado: {
    clave: 'compra_estado', titulo: 'Estado de una compra',
    slots: [{ clave: 'folio_compra', tipo: 'folio', obligatorio: true, pregunta: '¿De qué compra es? Escribe el folio (por ejemplo C-0001).', sinonimos: ['folio', 'compra'] },
      { clave: 'estado_compra', tipo: 'opcion', obligatorio: true, pregunta: '¿Salió el paquete (en trayecto) o ya llegó a Mérida?', opciones: [{ valor: 'enviada', texto: 'Ya salió (en trayecto)' }, { valor: 'llego_merida', texto: 'Llegó a Mérida' }], sinonimos: ['estado'] }],
  },
  compra_cierre: {
    clave: 'compra_cierre', titulo: 'Cierre de compra con faltante',
    slots: [{ clave: 'folio_compra', tipo: 'folio', obligatorio: true, pregunta: '¿Qué compra cierras con faltante? Escribe el folio (por ejemplo C-0001).', sinonimos: ['folio', 'compra'] }, opcional('motivo', '¿Qué pasó con lo que no llegó? (opcional)')],
  },
  envio_lote: {
    clave: 'envio_lote', titulo: 'Envío de pedidos',
    slots: [{ clave: 'folios', tipo: 'folios', obligatorio: true, pregunta: '¿Qué pedidos salen? Escribe sus folios, por ejemplo MG-001, LS-002.', sinonimos: ['pedidos', 'folios'] },
      { clave: 'paqueteria', tipo: 'opcion', obligatorio: true, pregunta: '¿Con qué paquetería salen: Castores, Pitic, DHL o Estafeta?', opciones: PAQUETERIAS_OPC, sinonimos: ['paqueteria'] }],
    avisoFinal: 'La guía puede llegar después: cuando la tengas, mándame las guías con su pedido.',
  },
  guias_lote: {
    clave: 'guias_lote', titulo: 'Captura de guías',
    slots: [{ clave: 'guias', tipo: 'guias', obligatorio: true, pregunta: '¿Cuáles son las guías? Escribe una por línea con su pedido, por ejemplo «MG-001 5551234».', sinonimos: ['guias', 'guia'] },
      opcional('paqueteria', '¿De qué paquetería son?')],
  },
  paquete_perdido: {
    clave: 'paquete_perdido', titulo: 'Paquete perdido o dañado',
    slots: [{ clave: 'pedido_folio', tipo: 'folio', obligatorio: true, pregunta: '¿De qué pedido es el paquete? Escribe el folio.', sinonimos: ['pedido', 'folio'] },
      { clave: 'incidente', tipo: 'opcion', obligatorio: true, pregunta: '¿Se perdió o llegó dañado?', opciones: [{ valor: 'perdido', texto: 'Se perdió' }, { valor: 'danado', texto: 'Llegó dañado' }], sinonimos: ['incidente', 'tipo'] },
      { clave: 'detalle', tipo: 'texto', obligatorio: true, pregunta: '¿Qué pasó? Dame el detalle en una frase.', sinonimos: ['detalle', 'motivo'] }],
  },
  alta_cliente: {
    clave: 'alta_cliente', titulo: 'Alta de cliente',
    slots: [nombre('¿Cómo se llama el cliente (nombre completo)?'), { clave: 'tipo_cliente', tipo: 'opcion', obligatorio: true, pregunta: '¿Es mayoreo o menudeo?', opciones: [{ valor: 'mayoreo', texto: 'Mayoreo' }, { valor: 'menudeo', texto: 'Menudeo' }], sinonimos: ['tipo'] },
      { clave: 'duenio', tipo: 'opcion', obligatorio: true, pregunta: '¿De qué socio es el cliente, Angelo o Javier?', opciones: SOCIOS, sinonimos: ['dueño', 'duenio', 'socio'] },
      { clave: 'plazo_habitual', tipo: 'opcion', obligatorio: true, pregunta: '¿Cuál es su plazo habitual de pago? Elige uno o escribe los días.', opciones: [{ valor: '0', texto: 'De contado' }, { valor: '8', texto: '8 días' }, { valor: '15', texto: '15 días' }, { valor: '30', texto: '30 días' }], sinonimos: ['plazo habitual', 'plazo'] }],
  },
  alta_sabor: {
    clave: 'alta_sabor', titulo: 'Alta de sabor',
    slots: [nombre('¿Cuál es el nombre exacto del sabor?'), { clave: 'modelo', tipo: 'texto', obligatorio: true, pregunta: '¿De qué modelo es el sabor?', sinonimos: ['modelo'] }],
  },
  alta_modelo: {
    clave: 'alta_modelo', titulo: 'Alta de modelo',
    slots: [nombre('¿Cuál es el nombre exacto del modelo?'), { clave: 'marca', tipo: 'texto', obligatorio: true, pregunta: '¿De qué marca es?', sinonimos: ['marca'] },
      { clave: 'puffs', tipo: 'texto', obligatorio: true, pregunta: '¿Cuántas caladas (puffs) tiene? Escribe el número o «no sé».', sinonimos: ['puffs', 'caladas'] },
      { clave: 'proveedor_costo', tipo: 'opcion', obligatorio: true, pregunta: '¿Con qué proveedor tiene costo de lista: Isaac o Karen? Si todavía no lo defines, elige «Sin costo por ahora» (no invento costos).',
        opciones: [{ valor: 'isaac', texto: 'Isaac' }, { valor: 'karen', texto: 'Karen' }, { valor: 'ninguno', texto: 'Sin costo por ahora' }], sinonimos: ['proveedor'] },
      { clave: 'costo', tipo: 'monto', obligatorio: true, si: { slot: 'proveedor_costo', valores: ['isaac', 'karen'] }, pregunta: '¿Cuál es el costo de lista? Escribe la cifra completa, por ejemplo 12,500.', sinonimos: ['costo'] }],
  },
};

export function esOperacionConv(x: string): x is OperacionConv {
  return (OPERACIONES_CONV as readonly string[]).includes(x);
}

export function defSlot(op: OperacionConv, clave: string): DefSlot | undefined {
  return OPERACIONES[op].slots.find((s) => s.clave === clave);
}

function vacio(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Espejo exacto de agente.slots_faltantes: claves obligatorias sin valor, en el orden en que se preguntan. */
export function slotsFaltantes(op: OperacionConv, slots: Readonly<Record<string, unknown>>): string[] {
  return OPERACIONES[op].slots
    .filter((s) => {
      if (!s.obligatorio) return false;
      if (s.si) {
        const v = slots[s.si.slot];
        if (s.si.valores === undefined ? vacio(v) : !s.si.valores.includes(String(v))) return false;
      }
      return vacio(slots[s.clave]);
    })
    .map((s) => s.clave);
}

/** Filas del espejo SQL (solo obligatorios), para verificar la migracion. */
export function filasEspejoSql(): Array<{ operacion: string; orden: number; slot: string; si_slot: string | null; si_valor: string[] | null }> {
  const filas: Array<{ operacion: string; orden: number; slot: string; si_slot: string | null; si_valor: string[] | null }> = [];
  for (const op of OPERACIONES_CONV) {
    let orden = 0;
    for (const s of OPERACIONES[op].slots) {
      if (!s.obligatorio) continue;
      orden += 1;
      filas.push({ operacion: op, orden, slot: s.clave, si_slot: s.si?.slot ?? null, si_valor: s.si?.valores ? [...s.si.valores] : null });
    }
  }
  return filas;
}
