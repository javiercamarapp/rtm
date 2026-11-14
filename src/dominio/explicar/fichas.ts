// Fichas fijas de "Explicar este numero": definicion en palabras, formula en simbolos, pagina fuente, cuentas del libro y terminos del glosario por familia de cifra.
// Es texto: ninguna cifra ni calculo de dinero vive aqui (los importes los entrega siempre la base). Una cifra sin ficha simplemente no muestra esas secciones.
export interface Enlace { href: string; texto: string }
export interface CuentaFicha { codigo: string; nombre: string }
export interface Ficha {
  definicion: string;
  formula: { palabras: string; simbolos: string } | null;
  glosario: readonly string[];
  fuente: Enlace | null;
  cuentas: readonly CuentaFicha[];
}

const C = (codigo: string, nombre: string): CuentaFicha => ({ codigo, nombre });
const INV = [C('1310', 'Inventario en bodega'), C('1320', 'Mercancía en tránsito')];
const CAJA = [C('1101', 'Efectivo físico de la sociedad'), C('1102', 'Banco de la sociedad'), C('1150', 'Fondos de la sociedad en poder de Angelo'), C('1160', 'Fondos de la sociedad en poder de Javier')];
const PROV = [C('2110', 'Proveedor Isaac'), C('2120', 'Proveedor Karen'), C('2190', 'Otros proveedores')];
const CAPITAL = [C('3110', 'Aportaciones de Angelo'), C('3120', 'Aportaciones de Javier'), C('3210', 'Retiros de Angelo'), C('3220', 'Retiros de Javier'), C('3310', 'Utilidades acumuladas de Angelo'), C('3320', 'Utilidades acumuladas de Javier')];
const RESULTADOS = [C('4110', 'Ventas de mayoreo'), C('4120', 'Ventas de menudeo a Omar'), C('4130', 'Ventas de menudeo al público'), C('5100', 'Costo de la mercancía vendida'), C('6120', 'Guías de salida desde bodega'), C('6290', 'Otros gastos de administración')];
const NOMBRES_CUENTA: Readonly<Record<string, string>> = { '1101': 'Efectivo físico de la sociedad', '1102': 'Banco de la sociedad', '1150': 'Fondos de la sociedad en poder de Angelo', '1160': 'Fondos de la sociedad en poder de Javier', '1210': 'Clientes por cobrar', '1220': 'Cuenta Omar: menudeo tomado de la bodega', '1310': 'Inventario en bodega', '1320': 'Mercancía en tránsito', '2110': 'Proveedor Isaac', '2120': 'Proveedor Karen', '2210': 'Renta de bodega por pagar a Omar', '2310': 'Pagos de Angelo por cuenta de la sociedad', '2320': 'Pagos de Javier por cuenta de la sociedad', '2410': 'Saldos a favor de clientes', '2420': 'Depósitos por identificar', '3110': 'Aportaciones de Angelo', '3120': 'Aportaciones de Javier', '3210': 'Retiros de Angelo', '3220': 'Retiros de Javier', '3310': 'Utilidades acumuladas de Angelo', '3320': 'Utilidades acumuladas de Javier', '4110': 'Ventas de mayoreo', '4120': 'Ventas de menudeo a Omar', '4130': 'Ventas de menudeo al público', '4220': 'Devoluciones sobre ventas', '5100': 'Costo de la mercancía vendida', '6110': 'Renta de bodega (Omar)' };

export const nombreDeCuenta = (codigo: string): string | null => NOMBRES_CUENTA[codigo] ?? null;

const f = (definicion: string, formula: Ficha['formula'], glosario: string[], fuente: Enlace | null, cuentas: readonly CuentaFicha[] = []): Ficha => ({ definicion, formula, glosario, fuente, cuentas });
const fmla = (palabras: string, simbolos: string) => ({ palabras, simbolos });

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Ficha de una cifra por su identificador (existencia:modelo:12, conta:saldo:1101, pedido:total:7...). null si la familia no tiene ficha. */
export function fichaDe(cifra: string): Ficha | null {
  const p = cifra.split(':');
  const [a, b] = p;
  switch (a) {
    case 'existencia':
      return f('Piezas físicas de un modelo sumando todas sus ubicaciones y sabores.', fmla('Entradas menos salidas, en orden, hasta hoy.', 'Existencia = Σ entradas − Σ salidas ± ajustes de conteo'), ['existencia', 'kardex'], { href: '/inventario/kardex', texto: 'Kardex de inventario' }, INV);
    case 'cobertura':
      return f('Piezas disponibles del modelo y los días que alcanzan al ritmo de venta reciente.', fmla('Existencia menos lo apartado, entre el consumo diario.', 'Disponible = existencia − apartado;  días = disponible ÷ consumo diario'), ['cobertura', 'existencia'], { href: '/inventario', texto: 'Inventario' }, INV);
    case 'inventario':
      return f('Valor del inventario a costo, nunca a precio de venta.', fmla('Cada modelo por su costo promedio, sumados todos.', 'Valor = Σ (existencia × costo promedio)'), ['existencia', 'costo', 'valuacion'], { href: '/inventario', texto: 'Inventario' }, INV);
    case 'margen':
      return f('Ganancia por pieza de un modelo para un cliente, contra cada proveedor posible.', fmla('Precio del tabulador menos costo vigente del proveedor.', 'Margen = precio − costo'), ['margen', 'costo'], p[1] && /^\d+$/.test(p[1]) ? { href: `/clientes/${p[1]}/precios`, texto: 'Precios del cliente' } : { href: '/catalogo/costos', texto: 'Costos del catálogo' }, [C('4110', 'Ventas de mayoreo'), C('5100', 'Costo de la mercancía vendida')]);
    case 'pedido':
      return f(b === 'saldo' ? 'Lo que el cliente aún debe de este pedido.' : 'Importe total del pedido según sus líneas.', b === 'saldo' ? fmla('Total del pedido menos los pagos aplicados.', 'Saldo = total − pagos') : fmla('Suma de las líneas del pedido, cada una a su precio.', 'Total = Σ (piezas × precio)'), ['por_cobrar'], p[2] && /^\d+$/.test(p[2]) ? { href: `/pedidos/${p[2]}`, texto: 'Pedido' } : { href: '/pedidos', texto: 'Pedidos' }, [C('1210', 'Clientes por cobrar'), C('4110', 'Ventas de mayoreo')]);
    case 'cxc':
      return f(b === 'cliente' ? 'Lo que un cliente debe en total.' : 'Lo que todos los clientes deben a la sociedad.', fmla('Pedidos entregados menos pagos aplicados.', 'Por cobrar = Σ (pedidos − pagos)'), ['por_cobrar'], { href: '/cuentas-por-cobrar', texto: 'Cuentas por cobrar' }, [C('1210', 'Clientes por cobrar'), C('2410', 'Saldos a favor de clientes'), C('2420', 'Depósitos por identificar')]);
    case 'proveedor':
      return f(b === 'falta' ? 'Cuánto falta por pagar al proveedor de la semana indicada.' : 'Saldo neto con el proveedor según el libro: a favor de la sociedad o lo que se le debe.', b === 'falta' ? fmla('Mercancía, seguros y guías de la semana menos los abonos.', 'Falta = mercancía + seguros + guías − abonos') : fmla('Abonos menos cargos de la cuenta del proveedor.', 'Posición = abonos − cargos'), ['posicion'], { href: '/proveedores', texto: 'Proveedores' }, PROV);
    case 'socio':
      return f(socioDef(b), socioFormula(b), ['reembolso', 'aportacion', 'retiro'], p[2] ? { href: `/socios/${p[2]}`, texto: `Cuenta de ${p[2]}` } : { href: '/socios', texto: 'Socios' }, [C('1150', 'Fondos de la sociedad en poder de Angelo'), C('1160', 'Fondos de la sociedad en poder de Javier'), C('1170', 'Faltantes de recepción por cobrar a Angelo'), C('1180', 'Faltantes de recepción por cobrar a Javier'), C('2310', 'Pagos de Angelo por cuenta de la sociedad'), C('2320', 'Pagos de Javier por cuenta de la sociedad')]);
    case 'socios':
      return f(b === 'cuadre' ? 'Señal de salud de Socios: si todas las identidades del libro se cumplen.' : 'Diferencia informativa entre lo que cada socio ha puesto para la compra.', b === 'cuadre' ? fmla('Auxiliar contra mayor, partida doble y efectivo repartido.', 'Conciliado = (auxiliar = mayor) ∧ (debe = haber) ∧ (efectivo repartido)') : null, ['libro_conciliado'], { href: '/socios', texto: 'Socios' }, CAPITAL);
    case 'cascada':
      return f(b === 'resultado' ? 'Parte de un socio en el reparto de la utilidad del periodo.' : 'Utilidad neta del periodo, desde los pedidos enviados hasta los gastos.', b === 'resultado' ? fmla('La utilidad neta se reparte 50/50, topada por el efectivo real.', 'Parte = utilidad neta × 50 %') : fmla('Pedidos y tomas de Omar, menos devoluciones, gastos y pérdidas de paquetes.', 'Utilidad = pedidos − devoluciones + tomas − gastos ± paquetes'), ['utilidad_neta', 'cascada'], { href: '/socios/cascada', texto: 'Cascada de reparto' }, RESULTADOS);
    case 'omar':
      return f('Cifra de la cuenta de Omar: renta de bodega, pagos recibidos y saldo.', fmla('Liquidaciones netas menos pagos aplicados.', 'Saldo = liquidado − pagado'), ['renta_devengada'], { href: '/omar', texto: 'Cuenta de Omar' }, [C('1220', 'Cuenta Omar: menudeo tomado de la bodega'), C('2210', 'Renta de bodega por pagar a Omar'), C('6110', 'Renta de bodega (Omar)')]);
    case 'devolucion':
      return f(b === 'proveedor' ? 'Devolución de piezas al proveedor y su efecto en la cuenta con él.' : 'Devolución de un cliente: crédito al cliente menos el costo de lo que vuelve a inventario.', b === 'proveedor' ? null : fmla('Crédito menos costo de las piezas que regresan a inventario.', 'Efecto = crédito − costo de lo devuelto'), ['devolucion'], { href: '/devoluciones', texto: 'Devoluciones' }, [C('4220', 'Devoluciones sobre ventas'), C('1310', 'Inventario en bodega'), C('2410', 'Saldos a favor de clientes')]);
    case 'paquete':
      return f(b === 'absorbe' ? 'Parte del costo del paquete perdido o dañado que absorbe cada quien.' : 'Valor de la mercancía del paquete perdido o dañado.', null, ['paquete'], { href: '/paquetes/en-trayecto', texto: 'Paquetes' });
    case 'historial':
      return f(historialDef(b), null, ['capital_aportado', 'utilidades_retenidas', 'retiro'], p[2] ? { href: `/socios/${p[2]}/historial`, texto: `Historial de ${p[2]}` } : null, CAPITAL);
    case 'capital':
      return f('Cifra de la tabla de capital por mes y por socio.', null, ['capital_aportado', 'aportacion', 'retiro'], { href: '/contabilidad/capital', texto: 'Capital por mes' }, CAPITAL);
    case 'ds':
    case 'dsu':
    case 'dsm':
      return f('Cifra del módulo de dropshipping, calculada con los pedidos del periodo.', null, ['costo', 'margen'], { href: a === 'dsu' ? '/dropshipping/utilidad' : '/dropshipping', texto: 'Dropshipping' });
    case 'conta':
      return fichaConta(p);
    default:
      return null;
  }
}

function socioDef(b: string | undefined): string {
  switch (b) {
    case 'deuda': return 'Lo que el socio debe a la sociedad en total.';
    case 'fondos': return 'Dinero de la sociedad que el socio tiene y aún no entrega.';
    case 'diferencia': return 'Faltantes de recepción asignados al socio.';
    case 'neto': return 'Posición neta con la sociedad. Positivo: la sociedad le debe. Negativo: él debe.';
    default: return 'Cifra de la cuenta del socio.';
  }
}
function socioFormula(b: string | undefined): Ficha['formula'] {
  if (b === 'neto') return fmla('Capital, más gastos pagados, menos reembolsos, capital devuelto y retiros, más utilidad asignada, menos lo que debe.', 'Neto = capital + gastos pagados − reembolsos − capital devuelto − retiros + utilidad asignada − deuda');
  return null;
}
function historialDef(b: string | undefined): string {
  switch (b) {
    case 'invertido': return 'Capital aportado por el socio: aportaciones declaradas, reinversiones de utilidad y apertura.';
    case 'retirado': return 'Lo que el socio ha retirado: utilidad, liquidaciones y devolución de aportaciones.';
    case 'utilidad': return 'Utilidad recibida por el socio en actas de corte firmadas.';
    case 'valor': return 'Valuación personal: capital aportado más su parte de la utilidad, menos los fondos de la sociedad en su poder.';
    case 'neta': return 'Aportación neta: lo aportado menos los fondos de la sociedad en su poder.';
    case 'parte': return 'Parte del socio en un acta de corte: disponible para retirar, reinvertir o dejar por distribuir.';
    default: return 'Cifra del historial personal del socio.';
  }
}

function fichaConta(p: string[]): Ficha | null {
  const b = p[1];
  if (b === 'efectivo') return f('Efectivo de las cajas de la empresa y de los socios contra el efectivo que muestra el libro contable.', fmla('Efectivo operativo contra las cuentas de caja y banco del libro.', 'Efectivo operativo = 1101 + 1102'), ['liquidez', 'dos_vias'], { href: '/contabilidad/caja', texto: 'Caja' }, CAJA);
  if (b === 'saldo') {
    const codigo = p[2] ?? '';
    return f('Saldo de una cuenta contable a la fecha de corte, con todos los movimientos que lo forman.', fmla('Cargos menos abonos (o al revés, según la naturaleza de la cuenta).', 'Saldo = Σ debe − Σ haber  (cuentas deudoras)'), ['saldo', 'libro_mayor', 'partida_doble'], { href: `/contabilidad/mayor?cuenta=${encodeURIComponent(codigo)}`, texto: 'Libro mayor de la cuenta' }, nombreDeCuenta(codigo) ? [C(codigo, nombreDeCuenta(codigo)!)] : [C(codigo, 'Cuenta del libro')]);
  }
  const val = { href: '/contabilidad/valuacion', texto: 'Valuación' };
  switch (b) {
    case 'v01': return f('Valor de todos los activos a costo.', fmla('Suma de las cuentas de activo.', 'Valuación = Σ activos'), ['valuacion'], val);
    case 'v02': return f('Todo lo que la sociedad debe.', fmla('Suma de las cuentas de pasivo.', 'Deudas = Σ pasivos'), ['valuacion'], val);
    case 'v03': return f('Capital contable: lo que queda al restar las deudas a la valuación.', fmla('Valuación menos deudas.', 'Capital contable = valuación − deudas'), ['valuacion', 'dos_vias'], val);
    case 'v04': return f('Resultado del periodo que todavía no se asigna a los socios.', fmla('Ingresos menos costos y gastos.', 'Resultado = Σ ingresos − Σ costos − Σ gastos'), ['utilidad_neta'], val);
    case 'v05': return f('Utilidad ya asignada a los socios que aún no retiran.', fmla('Utilidades acumuladas de cada socio.', 'Retenidas = 3310 + 3320'), ['utilidades_retenidas'], val, [C('3310', 'Utilidades acumuladas de Angelo'), C('3320', 'Utilidades acumuladas de Javier')]);
    case 'v06': return f('Capital que los socios han aportado, neto de retiros.', fmla('Aportaciones menos retiros de capital.', 'Capital aportado = 3110 + 3120 − 3210 − 3220'), ['capital_aportado'], val, CAPITAL.slice(0, 4));
    case 'l01': return f('Dinero de la sociedad: efectivo, banco y fondos en poder de socios.', fmla('Suma de las cuentas de caja, banco y fondos.', 'Liquidez = 1101 + 1102 + 1150 + 1160'), ['liquidez'], val, CAJA);
    case 'l02': return f('Liquidez más lo que deben los clientes.', fmla('Liquidez más cuentas por cobrar.', 'Liquidez total = liquidez + 1210'), ['liquidez', 'por_cobrar'], val, [...CAJA, C('1210', 'Clientes por cobrar')]);
    case 'utilidad': {
      const nivel = p[4] && !FECHA.test(p[4]) ? p[4] : p[5] ?? 'neta';
      const niveles: Record<string, { d: string; fm: Ficha['formula'] }> = {
        bruta: { d: 'Ventas netas y envío cobrado, menos el costo de lo vendido.', fm: fmla('Ventas netas más envío menos costo de ventas.', 'Bruta = ventas + envío − costo de ventas') },
        contribucion: { d: 'Utilidad bruta menos los gastos variables de venta.', fm: fmla('Utilidad bruta menos gastos variables.', 'Contribución = bruta − gastos variables') },
        neta: { d: 'Resultado del periodo después de todos los costos y gastos.', fm: fmla('Suma directa de las cuentas 4 a 7 del periodo.', 'Neta = Σ cuentas 4 a 7') },
      };
      const n = niveles[nivel] ?? niveles.neta!;
      return f(n.d, n.fm, ['utilidad_bruta', 'utilidad_contribucion', 'utilidad_neta'], { href: '/contabilidad/estado-de-resultados', texto: 'Estado de resultados' }, RESULTADOS);
    }
    default: return null;
  }
}

/** Fechas de periodo o corte que la propia clave de la cifra declara (ini:fin o al corte); null si la clave no trae fechas. */
export function periodoDe(cifra: string): { inicio: string | null; fin: string } | null {
  const fechas = cifra.split(':').filter((s) => FECHA.test(s));
  if (fechas.length >= 2) return { inicio: fechas[0]!, fin: fechas[1]! };
  if (fechas.length === 1) return { inicio: null, fin: fechas[0]! };
  return null;
}

/** Enlace de una partida a su cuenta o documento cuando el texto de la partida lo declara (codigo de cuenta al inicio, folio de liquidacion); si no, null. */
export function enlaceDePartida(concepto: string): Enlace | null {
  const cuenta = /^(\d{4})\s/.exec(concepto);
  if (cuenta) return { href: `/contabilidad/mayor?cuenta=${cuenta[1]}`, texto: 'Mayor' };
  if (/^Liquidaci[oó]n\b/.test(concepto)) return { href: '/proveedores/liquidacion', texto: 'Liquidación' };
  return null;
}
