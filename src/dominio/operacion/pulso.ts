// Pulso de arriba y pie de pagina: cifras reales de las lecturas existentes. Nunca un cero inventado: sin datos, "Sin dato".
import type { Existencia } from '../catalogo/tipos';
import { etiquetaFecha, formatearMoneda, formatearPiezas } from '../formato';
import { tarjetaValuacion, type CuentaSociosValuacion, type Socio } from '../socios/valuacion';
import type { CuentaProveedor, CuentaSocios, CuentasPorCobrar } from './tipos';

export interface ChipPulso {
  clave: 'isaac' | 'cobrar' | 'socios' | 'bodega';
  etiqueta: string;
  /** null = no hay datos: la interfaz escribe "Sin dato". */
  texto: string | null;
  /** Cifra para "Explicar este numero"; null cuando la base aun no sabe explicarla (se enlaza al detalle). */
  cifra: string | null;
  /** Enlace al detalle cuando la cifra no es explicable todavia. */
  href: string | null;
  /** Aclaracion corta ("a favor", "se debe"). */
  detalle: string | null;
}

export interface Pulso { chips: ChipPulso[]; corte: string | null }

export interface EntradasPulso {
  isaac: CuentaProveedor | null;
  cxc: CuentasPorCobrar | null;
  socios: CuentaSocios | null;
  /** Valuacion de los socios (api.cuenta_socios_valuacion) y el socio con sesion: alimenta el chip personal 'Tu valuacion'. */
  valuacion?: { cuenta: CuentaSociosValuacion; yo: Socio } | null;
  existencia: Existencia | null;
}

/** Por pagar a Isaac: DEUDA DE LA EMPRESA con el proveedor = el total del Mayor (cuenta 2110) menos los pedidos a costo del socio de menudeo que aun no paga (a su cuenta, no son deuda de la empresa; van aparte en el detalle). Misma cifra que 'Deuda de la empresa' en Proveedores. Sin movimientos ni posicion no hay dato. */
function chipIsaac(c: CuentaProveedor | null): ChipPulso {
  const base: ChipPulso = { clave: 'isaac', etiqueta: 'Por pagar a Isaac', texto: null, cifra: null, href: '/proveedores?p=Isaac', detalle: null };
  if (!c || (c.movimientos.length === 0 && c.posicion_cent === 0n)) return base;
  const cifra = 'proveedor:deuda:Isaac';
  const emp = c.posicion.posicion_empresa_cent;
  const aparte = c.posicion.menudeo_pendiente_cent > 0n ? ` · aparte ${formatearMoneda(c.posicion.menudeo_pendiente_cent)} de pedidos del socio` : '';
  if (emp < 0n) return { ...base, texto: formatearMoneda(-emp), cifra, href: null, detalle: `deuda de la empresa${aparte}` };
  if (emp > 0n) return { ...base, texto: formatearMoneda(emp), cifra, href: null, detalle: `a favor${aparte}` };
  return { ...base, texto: formatearMoneda(0n), cifra, href: null, detalle: `saldo cero${aparte}` };
}

function chipCobrar(c: CuentasPorCobrar | null): ChipPulso {
  const base: ChipPulso = { clave: 'cobrar', etiqueta: 'Por cobrar', texto: null, cifra: null, href: '/cuentas-por-cobrar', detalle: null };
  if (!c || (c.filas.length === 0 && (c.apertura?.length ?? 0) === 0 && c.saldos_a_favor.length === 0 && c.pagos_sin_identificar.length === 0)) return base;
  return { ...base, texto: formatearMoneda(c.total_cent), cifra: 'cxc:total', href: null };
}

/** Tu valuacion (reemplaza a 'Entre socios', que mostraba la diferencia informativa por la compra): la valuacion personal y cuanto mas o menos tiene contra el otro socio.
 *  Misma fuente que Inicio, Cuenta de socios y Balance (api.cuenta_socios_valuacion). Sin sesion de socio con nombre o sin lectura: "Sin dato". */
function chipSocios(v: EntradasPulso['valuacion']): ChipPulso {
  const base: ChipPulso = { clave: 'socios', etiqueta: 'Tu valuación', texto: null, cifra: null, href: '/socios', detalle: null };
  if (!v || !v.cuenta.hay_movimientos) return base;
  const t = tarjetaValuacion(v.cuenta, v.yo, formatearMoneda);
  if (!t) return base;
  const x = formatearMoneda(v.cuenta.comparacion.diferencia_valuacion_cent);
  const detalle = t.estado === 'igual' ? `igualado con ${t.otro}` : t.estado === 'mas' ? `+${x} contra ${t.otro}` : `-${x} contra ${t.otro}`;
  return { ...base, texto: t.valorTexto, cifra: `historial:valor:${v.yo}`, href: null, detalle };
}

/** En bodega: suma de piezas de los modelos con movimientos. Aun no hay una cifra explicable del total: enlaza al inventario, donde cada modelo si se explica. */
function chipBodega(e: Existencia | null): ChipPulso {
  const base: ChipPulso = { clave: 'bodega', etiqueta: 'En bodega', texto: null, cifra: null, href: '/inventario', detalle: null };
  if (!e) return base;
  const conDato = e.modelos.filter((m) => m.piezas !== null);
  if (conDato.length === 0) return base;
  return { ...base, texto: formatearPiezas(conDato.reduce((a, m) => a + (m.piezas ?? 0), 0)) };
}

export function armarPulso(e: EntradasPulso): Pulso {
  const chips = [chipIsaac(e.isaac), chipCobrar(e.cxc), chipSocios(e.valuacion), chipBodega(e.existencia)];
  const fecha = e.cxc?.hoy ?? e.socios?.hoy ?? null;
  const hayDatos = chips.some((c) => c.texto !== null);
  return { chips, corte: hayDatos && fecha ? etiquetaFecha(fecha) : null };
}
