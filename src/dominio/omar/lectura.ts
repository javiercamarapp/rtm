// Parsers de lista blanca: convierten lo que devuelve la base (jsonb o filas de las vistas omar) en los tipos de Omar, copiando SOLO los campos conocidos.
// Una columna de mas en la base (costo, cliente, folio de pedido) no cruza esta frontera.
import type { ConfiguracionOmar, EstadoPaquete, EstadoSolicitud, LiquidacionOmar, MovimientoCuenta, PaqueteOmar, PiezaDisponible, Solicitud } from './tipos';

type Fila = Record<string, unknown>;
const esFila = (v: unknown): v is Fila => v !== null && typeof v === 'object' && !Array.isArray(v);
const texto = (v: unknown): string => (typeof v === 'string' ? v : '');
const entero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : 0);
function cent(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return null;
}
const lista = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter(esFila) : []);

export function parsearDisponible(v: unknown): PiezaDisponible[] {
  return lista(v)
    .map((f) => ({ modelo: texto(f.modelo), sabor: texto(f.sabor), piezas: entero(f.piezas) }))
    .filter((p) => p.modelo !== '' && p.piezas > 0)
    .sort((a, b) => a.modelo.localeCompare(b.modelo) || a.sabor.localeCompare(b.sabor));
}

/** La renta pierde el folio del pedido (el numero de pedidos es ritmo del negocio): se renumera R-001 en orden de fecha. */
export function parsearCuenta(v: unknown): MovimientoCuenta[] {
  const filas = lista(v).map((f) => {
    const c = texto(f.concepto);
    const concepto = c === 'renta' || c === 'toma' || c === 'pago' ? c : null;
    return concepto ? { concepto, f } : null;
  }).filter((x): x is { concepto: MovimientoCuenta['concepto']; f: Fila } => x !== null);
  filas.sort((a, b) => texto(a.f.fecha).localeCompare(texto(b.f.fecha)));
  let n = 0;
  return filas.map(({ concepto, f }) => ({
    concepto,
    fecha: texto(f.fecha),
    referencia: concepto === 'renta' ? `R-${String(++n).padStart(3, '0')}` : texto(f.referencia),
    modelo: concepto === 'pago' ? null : texto(f.modelo) || null,
    piezas: f.piezas === null || f.piezas === undefined ? null : entero(f.piezas),
    tarifa: cent(f.tarifa),
    importe: cent(f.importe) ?? 0n,
  }));
}

const ESTADOS: readonly EstadoSolicitud[] = ['pendiente', 'autorizada', 'rechazada', 'caducada', 'deshecha'];
export function parsearSolicitudes(v: unknown): Solicitud[] {
  return lista(v).map((f) => ({
    folio: texto(f.folio),
    modelo: texto(f.modelo),
    sabor: texto(f.sabor),
    piezas: entero(f.piezas),
    estado: (ESTADOS as readonly string[]).includes(texto(f.estado)) ? (texto(f.estado) as EstadoSolicitud) : 'pendiente',
    solicitada_at: texto(f.solicitada_at),
    caduca_at: texto(f.caduca_at),
    resuelta_at: texto(f.resuelta_at) || null,
  })).sort((a, b) => b.solicitada_at.localeCompare(a.solicitada_at));
}

export function parsearLiquidaciones(v: unknown): LiquidacionOmar[] {
  return lista(v).map((f) => ({
    folio: texto(f.folio), semana_ini: texto(f.semana_ini), semana_fin: texto(f.semana_fin),
    renta_cent: cent(f.renta_cent) ?? 0n, tomas_cent: cent(f.tomas_cent) ?? 0n, compensado_cent: cent(f.compensado_cent) ?? 0n,
    neto_cent: cent(f.neto_cent) ?? 0n, pagado_cent: cent(f.pagado_cent) ?? 0n, fecha_cierre: texto(f.fecha_cierre),
  })).sort((a, b) => b.semana_ini.localeCompare(a.semana_ini));
}

const ESTADOS_PAQUETE: readonly EstadoPaquete[] = ['por_empacar', 'empacado', 'en_trayecto', 'llego'];
export function parsearPaquetes(v: unknown): PaqueteOmar[] {
  return lista(v).map((f, i) => ({
    consecutivo: f.consecutivo === undefined ? i + 1 : entero(f.consecutivo),
    tipo: texto(f.tipo) === 'entrada' ? ('entrada' as const) : ('salida' as const),
    estado: (ESTADOS_PAQUETE as readonly string[]).includes(texto(f.estado)) ? (texto(f.estado) as EstadoPaquete) : 'por_empacar',
    horas: f.horas === null || f.horas === undefined ? null : entero(f.horas),
    llegada_estimada: texto(f.llegada_estimada) || null,
    renglones: lista(f.renglones).map((r) => ({ modelo: texto(r.modelo), sabor: texto(r.sabor), piezas: entero(r.piezas) })).filter((r) => r.piezas > 0),
  }));
}

export function parsearConfiguracion(v: unknown): ConfiguracionOmar | null {
  if (!esFila(v)) return null;
  const tope = entero(v.tope_toma_piezas);
  const horas = entero(v.caduca_horas);
  if (tope < 1 || horas < 1) return null;
  return { tope_toma_piezas: tope, caduca_horas: horas, renta_por_pieza_cent: cent(v.renta_por_pieza_cent) };
}
