// Traduccion inversa de la integracion (16-nov): una operacion COMPLETA de la maquina de conversacion (slots ya resueltos: ids de catalogo, centavos, dias) se convierte en la
// intencion que entiende el carril de frenos, mas los `overrides` con los ids ya elegidos para que `resolverAccion` no vuelva a preguntar ni a adivinar.
// Los montos son los que el socio escribio (la maquina los valido contra la cita); aqui no se calcula dinero.
import type { Intencion, TipoGasto, QuienPaga, SocioNombre } from '@/dominio/agente/intenciones';
import type { OperacionConv } from '@/dominio/agente/slots';
import type { Overrides } from './resolucion';
import type { OrigenDs } from '@/dominio/agente/intenciones_ampliadas';
import { paqueteriaDeCatalogo } from '@/dominio/agente/guias';

export interface LineaSlot { modeloId: string; modelo: string; saborId: string | null; sabor: string | null; piezas: number }

export type TraduccionSlots = { ok: true; intencion: Intencion; overrides: Overrides } | { ok: false; texto: string };

const nombre = (v: unknown): string => (typeof v === 'string' && v !== '' ? v[0]!.toUpperCase() + v.slice(1) : '');
const idDe = (v: unknown): string | null => (v !== null && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null);
const nombreDe = (v: unknown): string => (v !== null && typeof v === 'object' && 'nombre' in v ? String((v as { nombre: unknown }).nombre) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function overridesDeLineas(ls: readonly LineaSlot[]): Record<string, string> {
  const o: Record<string, string> = {};
  ls.forEach((l, i) => {
    o[`lineas.${i}.modelo`] = l.modeloId;
    if (l.saborId !== null) o[`lineas.${i}.sabor`] = l.saborId;
  });
  return o;
}

export function intencionDeSlots(operacion: OperacionConv, s: Readonly<Record<string, unknown>>, cita: string): TraduccionSlots {
  const c = cita.slice(0, 120) || 'conversacion';
  const ls = (Array.isArray(s.lineas) ? s.lineas : []) as LineaSlot[];
  const lineasTxt = ls.map((l) => ({ modelo_texto: l.modelo, sabor_texto: l.sabor, piezas: l.piezas }));
  switch (operacion) {
    case 'pedido_bodega': {
      const cli = idDe(s.cliente);
      const dias = s.modalidad === 'contado' ? 0 : num(s.plazo);
      if (cli === null || ls.length === 0 || dias === null) return { ok: false, texto: 'Falta el cliente, las piezas o el plazo.' };
      return {
        ok: true,
        intencion: {
          tipo: 'pedido', cliente_texto: nombreDe(s.cliente), destino_texto: txt(s.destino), lineas: lineasTxt.map((l) => ({ ...l, precio_texto: null, fuente_cita: c })),
          envio_cobrado_centavos: num(s.envio) ?? 0, plazo_texto: null, plazo_dias: dias, plazo_fecha_dicha: null, fuente_cita: c,
        },
        overrides: { cliente: cli, ...overridesDeLineas(ls) },
      };
    }
    case 'cobro_cliente': {
      const cli = idDe(s.cliente);
      const m = num(s.monto);
      if (cli === null || m === null) return { ok: false, texto: 'Falta el cliente o el monto.' };
      return { ok: true, intencion: { tipo: 'pago', cliente_texto: nombreDe(s.cliente), monto_centavos: m, cuenta_destino_texto: nombre(s.cuenta) || null, pedido_folio: txt(s.pedido), fuente_cita: c }, overrides: { cliente: cli } };
    }
    case 'pago_proveedor':
    case 'pago_redirigido': {
      const prov = idDe(s.proveedor);
      const m = num(s.monto);
      if (prov === null || m === null) return { ok: false, texto: 'Falta el proveedor o el monto.' };
      const redirigido = operacion === 'pago_redirigido';
      const cli = redirigido ? idDe(s.cliente) : null;
      if (redirigido && cli === null) return { ok: false, texto: 'Falta el cliente.' };
      return {
        ok: true,
        intencion: {
          tipo: 'pago_proveedor', proveedor_texto: nombreDe(s.proveedor), monto_centavos: m, pagado_por: (redirigido ? 'sociedad' : String(s.pagado_por ?? '')) as QuienPaga,
          cliente_texto: redirigido ? nombreDe(s.cliente) : null, intencion: s.intencion === 'capital' ? 'capital' : s.intencion === 'reembolso' ? 'reembolso' : null, fuente_cita: c,
        },
        overrides: { proveedor: prov, ...(cli !== null ? { cliente: cli } : {}) },
      };
    }
    case 'gasto': {
      const m = num(s.monto);
      if (m === null || txt(s.tipo_gasto) === null || txt(s.pagado_por) === null) return { ok: false, texto: 'Falta el tipo, el monto o quien pago.' };
      return { ok: true, intencion: { tipo: 'gasto', gasto: String(s.tipo_gasto) as TipoGasto, monto_centavos: m, pagado_por: String(s.pagado_por) as QuienPaga, descripcion: txt(s.referencia), fuente_cita: c }, overrides: {} };
    }
    case 'aportacion': {
      const m = num(s.monto);
      if (m === null || txt(s.socio) === null) return { ok: false, texto: 'Falta el socio o el monto.' };
      return { ok: true, intencion: { tipo: 'aportacion', socio: String(s.socio) as SocioNombre, monto_centavos: m, motivo: txt(s.motivo), intencion: s.intencion === 'capital' ? 'capital' : 'reembolso', fuente_cita: c }, overrides: {} };
    }
    case 'reembolso':
    case 'retiro': {
      const m = num(s.monto);
      if (m === null || txt(s.socio) === null) return { ok: false, texto: 'Falta el socio o el monto.' };
      const via = s.via === 'efectivo' ? 'efectivo' : s.via === 'transferencia' ? 'transferencia' : null;
      return { ok: true, intencion: operacion === 'reembolso' ? { tipo: 'reembolso_socio', socio: String(s.socio) as SocioNombre, monto_centavos: m, via, fuente_cita: c } : { tipo: 'retiro_utilidad', socio: String(s.socio) as SocioNombre, monto_centavos: m, via, fuente_cita: c }, overrides: {} };
    }
    case 'conteo':
      if (ls.length === 0) return { ok: false, texto: 'Faltan las piezas.' };
      return { ok: true, intencion: { tipo: 'conteo', lineas: lineasTxt, fuente_cita: c }, overrides: overridesDeLineas(ls) };
    case 'alta_cliente':
      if (txt(s.nombre) === null) return { ok: false, texto: 'Falta el nombre.' };
      return { ok: true, intencion: { tipo: 'cliente_alta', nombre: String(s.nombre), fuente_cita: c }, overrides: {} };
    case 'pedido_dropshipping': {
      const cli = idDe(s.cliente);
      const dias = s.modalidad === 'contado' ? 0 : num(s.plazo);
      const origen = txt(s.origen) as OrigenDs | null;
      if (cli === null || ls.length === 0 || dias === null || origen === null) return { ok: false, texto: 'Falta el cliente, el proveedor, las piezas o el plazo.' };
      const fp = txt(s.folio_proveedor);
      return {
        ok: true,
        intencion: {
          tipo: 'pedido_ds', cliente_texto: nombreDe(s.cliente), proveedor_origen: origen, lineas: lineasTxt.map((l) => ({ modelo_texto: l.modelo_texto, sabor_texto: l.sabor_texto, piezas: l.piezas })),
          forma_pago: dias === 0 ? 'contado' : 'credito', plazo_texto: null, plazo_dias: dias, envio_cobrado_centavos: num(s.envio) ?? 0,
          folio_proveedor_texto: fp !== null && /\d/.test(fp) ? fp : null, fuente_cita: c,
        },
        overrides: { cliente: cli, ...overridesDeLineas(ls) },
      };
    }
    case 'pedido_a_costo': {
      const origen = txt(s.origen) as OrigenDs | null;
      const f = s.fecha_pago !== null && typeof s.fecha_pago === 'object' ? (s.fecha_pago as { fecha: string | null; hora: string | null; sinFecha: boolean }) : null;
      if (ls.length === 0 || origen === null || f === null) return { ok: false, texto: 'Faltan las piezas, el proveedor o la fecha de pago.' };
      return {
        ok: true,
        intencion: { tipo: 'pedido_menudeo', proveedor_origen: origen, lineas: lineasTxt, cuando_texto: null, fecha_compromiso: f.fecha, hora_compromiso: f.hora, sin_fecha: f.sinFecha === true, fuente_cita: c },
        overrides: overridesDeLineas(ls),
      };
    }
    case 'compra':
    case 'orden_compra': {
      const prov = idDe(s.proveedor);
      if (prov === null || ls.length === 0) return { ok: false, texto: 'Falta el proveedor o las piezas.' };
      const base = { proveedor_texto: nombreDe(s.proveedor), lineas: lineasTxt, fuente_cita: c };
      const intencion = operacion === 'compra'
        ? { tipo: 'compra' as const, ...base, guia_centavos: num(s.guia), pagado_por: (txt(s.guia_pagada_por) as QuienPaga | null) }
        : { tipo: 'orden_compra' as const, ...base, aplicar_saldo: false };
      return { ok: true, intencion, overrides: { proveedor: prov, ...overridesDeLineas(ls) } };
    }
    case 'recepcion_compra': {
      const folio = txt(s.folio_compra);
      if (folio === null) return { ok: false, texto: 'Falta el folio de la compra.' };
      const parcial = s.alcance === 'parcial';
      if (parcial && ls.length === 0) return { ok: false, texto: 'Faltan las piezas que llegaron.' };
      return { ok: true, intencion: { tipo: 'compra_recepcion', compra_folio: folio, lineas: parcial ? lineasTxt : [], fuente_cita: c }, overrides: parcial ? overridesDeLineas(ls) : {} };
    }
    case 'compra_estado': {
      const folio = txt(s.folio_compra);
      const est = txt(s.estado_compra);
      if (folio === null || (est !== 'enviada' && est !== 'llego_merida')) return { ok: false, texto: 'Falta el folio de la compra o su estado.' };
      return { ok: true, intencion: { tipo: 'compra_estado', compra_folio: folio, estado: est, fuente_cita: c }, overrides: {} };
    }
    case 'compra_cierre': {
      const folio = txt(s.folio_compra);
      if (folio === null) return { ok: false, texto: 'Falta el folio de la compra.' };
      return { ok: true, intencion: { tipo: 'compra_cierre', compra_folio: folio, motivo: txt(s.motivo), fuente_cita: c }, overrides: {} };
    }
    case 'devolucion': {
      const cli = idDe(s.cliente);
      const folio = txt(s.pedido_folio);
      const destino = s.destino_piezas === 'merma' ? 'merma' : s.destino_piezas === 'inventario' ? 'inventario' : null;
      if (cli === null || folio === null || ls.length === 0 || destino === null || txt(s.motivo) === null) return { ok: false, texto: 'Falta el cliente, el pedido, las piezas, su destino o el motivo.' };
      return { ok: true, intencion: { tipo: 'devolucion', cliente_texto: nombreDe(s.cliente), pedido_folio: folio, lineas: lineasTxt, destino, motivo: txt(s.motivo), fuente_cita: c }, overrides: { cliente: cli, ...overridesDeLineas(ls) } };
    }
    case 'paquete_perdido': {
      const folio = txt(s.pedido_folio);
      const inc = s.incidente === 'danado' ? 'danado' : s.incidente === 'perdido' ? 'perdido' : null;
      if (folio === null || inc === null || txt(s.detalle) === null) return { ok: false, texto: 'Falta el pedido, si se perdio o llego danado, o el detalle.' };
      return { ok: true, intencion: { tipo: 'paquete_perdido', pedido_folio: folio, cliente_texto: null, incidente: inc, detalle: txt(s.detalle), fuente_cita: c }, overrides: {} };
    }
    case 'envio_lote': {
      const folios = Array.isArray(s.folios) ? (s.folios as unknown[]).map(String) : [];
      const paq = paqueteriaDeCatalogo(txt(s.paqueteria));
      if (folios.length === 0 || paq === null) return { ok: false, texto: 'Faltan los pedidos o una paqueteria del catalogo (Castores, Pitic, DHL o Estafeta).' };
      return { ok: true, intencion: { tipo: 'envio_lote', paqueteria: paq.toLowerCase() as 'castores' | 'pitic' | 'dhl' | 'estafeta', folios, fuente_cita: c }, overrides: {} };
    }
    case 'guias_lote': {
      const gs = Array.isArray(s.guias) ? (s.guias as Array<{ folio: string; guia: string }>) : [];
      if (gs.length === 0) return { ok: false, texto: 'Faltan las guias.' };
      const paq = paqueteriaDeCatalogo(txt(s.paqueteria));
      return { ok: true, intencion: { tipo: 'guias_lote', paqueteria: paq === null ? null : (paq.toLowerCase() as 'castores' | 'pitic' | 'dhl' | 'estafeta'), guias: gs.map((g) => ({ pedido_folio: g.folio, cliente_texto: null, guia_texto: g.guia })), fuente_cita: c }, overrides: {} };
    }
    default:
      return { ok: false, texto: 'Esta operacion todavia no se registra por conversacion.' };
  }
}
