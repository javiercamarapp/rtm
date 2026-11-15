// Traduccion inversa de la integracion (16-nov): una operacion COMPLETA de la maquina de conversacion (slots ya resueltos: ids de catalogo, centavos, dias) se convierte en la
// intencion que entiende el carril de frenos, mas los `overrides` con los ids ya elegidos para que `resolverAccion` no vuelva a preguntar ni a adivinar.
// Los montos son los que el socio escribio (la maquina los valido contra la cita); aqui no se calcula dinero.
import type { Intencion, TipoGasto, QuienPaga, SocioNombre } from '@/dominio/agente/intenciones';
import type { OperacionConv } from '@/dominio/agente/slots';
import type { Overrides } from './resolucion';
import { tipoCambioMicro } from '@/dominio/agente/tipo_cambio';

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
    case 'deposito':
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
    case 'entrega_fondos': {
      const m = num(s.monto);
      const dest = txt(s.destino);
      if (m === null || txt(s.socio) === null || (dest !== 'sociedad' && dest !== 'isaac' && dest !== 'karen')) return { ok: false, texto: 'Falta el socio, el destino o el monto.' };
      return { ok: true, intencion: { tipo: 'entrega_fondos', socio: String(s.socio) as SocioNombre, destino: dest, monto_centavos: m, via: s.via === 'efectivo' ? 'efectivo' : s.via === 'transferencia' ? 'transferencia' : null, fuente_cita: c }, overrides: {} };
    }
    case 'liquidacion': {
      const m = num(s.monto);
      if (m === null || txt(s.socio) === null || txt(s.contraparte) === null) return { ok: false, texto: 'Falta quien paga, a quien o el monto.' };
      return { ok: true, intencion: { tipo: 'liquidacion_socios', de_socio: String(s.socio) as SocioNombre, a_socio: String(s.contraparte) as SocioNombre, monto_centavos: m, via: s.via === 'efectivo' ? 'efectivo' : s.via === 'transferencia' ? 'transferencia' : null, fuente_cita: c }, overrides: {} };
    }
    case 'retiro_capital': {
      const m = num(s.monto);
      if (m === null || txt(s.socio) === null) return { ok: false, texto: 'Falta el socio o el monto.' };
      return { ok: true, intencion: { tipo: 'retiro_capital', socio: String(s.socio) as SocioNombre, monto_centavos: m, via: null, fuente_cita: c }, overrides: {} };
    }
    case 'renta_omar': {
      const m = num(s.monto);
      if (m === null || txt(s.pagado_por) === null) return { ok: false, texto: 'Falta quien pago o el monto.' };
      return { ok: true, intencion: { tipo: 'renta_omar', monto_centavos: m, pagado_por: String(s.pagado_por) as QuienPaga, via: s.via === 'efectivo' ? 'efectivo' : s.via === 'transferencia' ? 'transferencia' : null, nota: null, fuente_cita: c }, overrides: {} };
    }
    case 'gasto_servicio': {
      const m = num(s.monto);
      const usd = s.moneda === 'usd';
      if (m === null || txt(s.servicio) === null || txt(s.pagado_por) === null || (s.moneda !== 'usd' && s.moneda !== 'mxn')) return { ok: false, texto: 'Falta el servicio, la moneda, el monto o quien pago.' };
      return {
        ok: true,
        intencion: { tipo: 'gasto_servicio', servicio_texto: String(s.servicio), monto_usd_centavos: usd ? m : null, monto_mxn_centavos: usd ? null : m, tipo_cambio_micro: usd ? tipoCambioMicro(txt(s.tipo_cambio)) : null, pagado_por: String(s.pagado_por) as QuienPaga, fuente_cita: c },
        overrides: {},
      };
    }
    case 'conteo':
      if (ls.length === 0) return { ok: false, texto: 'Faltan las piezas.' };
      return { ok: true, intencion: { tipo: 'conteo', lineas: lineasTxt, fuente_cita: c }, overrides: overridesDeLineas(ls) };
    case 'alta_cliente':
      if (txt(s.nombre) === null) return { ok: false, texto: 'Falta el nombre.' };
      return { ok: true, intencion: { tipo: 'cliente_alta', nombre: String(s.nombre), fuente_cita: c }, overrides: {} };
    default:
      return { ok: false, texto: 'Esta operacion todavia no se registra por conversacion.' };
  }
}
