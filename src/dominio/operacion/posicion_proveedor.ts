// Posicion con un proveedor: UNA sola verdad en pantalla. Es la del libro (cuenta 2110 o 2120), la misma de Inicio, Contabilidad y Capital.
// Nada aqui calcula dinero: solo redacta, con la lengua del negocio, las cifras que ya entrega la base (api.proveedor_cuenta y api.proveedor_hoja).
import { formatearMoneda } from '../formato';
import type { CuentaProveedor, HojaProveedor } from './tipos';

export type TonoPosicion = 'debe' | 'favor' | 'cero';

export interface PosicionProveedorVM {
  /** Tono de la deuda de la EMPRESA (sin los pedidos del socio de menudeo pendientes de pago). */
  tono: TonoPosicion;
  /** Frase del encabezado: "Deuda de la empresa con Karen $532.50" / "A favor de la sociedad con Karen $310.00". */
  titular: string;
  /** Monto sin signo, en pesos. */
  monto: string;
  palabra: 'Deuda de la empresa' | 'A favor de la sociedad' | 'Saldo cero';
  /** Una linea del libro: costo de pedidos y compras menos pagos y abonos igual al total con el proveedor. */
  desglose: string;
  /** Total con el proveedor segun el libro, en lengua del negocio ("Se le debe $2,945.00"). */
  totalLibro: string;
  /** Pedidos del socio de menudeo pendientes de pago (a su cuenta, no son deuda de la empresa). */
  socio: string;
  pedidosSocio: { hay: boolean; pendiente: string; pagado: string; costo: string; pedidos: number };
  /** Linea de conciliacion: libro = deuda de la empresa + pedidos del socio pendientes. Null si no hay pedidos del socio con este proveedor. */
  conciliacionLibro: string | null;
  /** Anticipo (prepago) como detalle, no como saldo: solo cuando la posicion de la empresa es a favor. */
  anticipo: string | null;
  /** Reconciliacion de la lista movimiento por movimiento (cuenta corriente) con el total del libro. */
  reconciliacion: { cuentaCorriente: string; otrosCargos: string; posicion: string; texto: string };
  /** Libro y auxiliar dicen lo mismo. */
  cuadra: boolean;
}

const pesos = (c: bigint, conSigno = false): string => formatearMoneda(c, conSigno ? { conSigno: true } : {});
const abs = (c: bigint): bigint => (c < 0n ? -c : c);
const aLengua = (c: bigint): string => (c < 0n ? `Se le debe ${pesos(-c)}` : c > 0n ? `A favor ${pesos(c)}` : 'Saldo cero');

export function armarPosicionProveedor(c: CuentaProveedor, socio = 'Angelo'): PosicionProveedorVM {
  const d = c.posicion;
  const libro = c.posicion_cent;
  const emp = d.posicion_empresa_cent;
  const tono: TonoPosicion = emp < 0n ? 'debe' : emp > 0n ? 'favor' : 'cero';
  const palabra = tono === 'debe' ? 'Deuda de la empresa' : tono === 'favor' ? 'A favor de la sociedad' : 'Saldo cero';
  const titular = tono === 'debe' ? `Deuda de la empresa con ${c.proveedor} ${pesos(abs(emp))}` : tono === 'favor' ? `A favor de la sociedad con ${c.proveedor} ${pesos(emp)}` : `Saldo cero con ${c.proveedor}`;
  const desglose = `Costo de pedidos y compras ${pesos(d.cargos_cent)} − pagos y abonos ${pesos(d.abonos_cent)} = total con ${c.proveedor} según el libro ${aLengua(libro).toLowerCase()}`;
  const anticipo = tono === 'favor' ? `Anticipo pagado por adelantado, aún sin consumir con pedidos: ${pesos(emp)}` : null;
  const otros = c.saldo_cent - libro;
  const texto = `Movimientos de la cuenta ${pesos(c.saldo_cent, true)} − costo de pedidos directos y otros cargos del libro ${pesos(otros)} = total según el libro ${pesos(libro, true)}`;
  const hay = d.menudeo_pedidos > 0;
  const totalAbs = pesos(abs(libro));
  const conciliacionLibro = hay
    ? `Total con ${c.proveedor} según el libro ${libro < 0n ? '' : 'a favor '}${totalAbs} = ${tono === 'favor' ? 'a favor de la sociedad' : 'deuda de la empresa'} ${pesos(abs(emp))} + pedidos de ${socio} pendientes ${pesos(d.menudeo_pendiente_cent)}`
    : null;
  return {
    tono, titular, monto: pesos(abs(emp)), palabra, desglose, totalLibro: aLengua(libro), socio,
    pedidosSocio: { hay, pendiente: pesos(d.menudeo_pendiente_cent), pagado: pesos(d.menudeo_pagado_cent), costo: pesos(d.menudeo_costo_cent), pedidos: d.menudeo_pedidos },
    conciliacionLibro, anticipo,
    reconciliacion: { cuentaCorriente: pesos(c.saldo_cent, true), otrosCargos: pesos(otros), posicion: pesos(libro, true), texto },
    cuadra: d.desglose_cuadra && d.cuadra_auxiliar !== false,
  };
}

export interface HojaVM {
  /** La hoja termina en el mismo saldo que el libro al corte (o no aplica porque incluye partidas fuera de la sociedad). */
  cuadraConLibro: boolean;
  /** Texto del sello: 'Cuadra con el libro' o 'No cuadra: diferencia $X'. */
  sello: string;
  /** Nota al pie con el saldo del libro y, si lo hay, la diferencia. */
  nota: string;
  /** Saldo anterior en lengua del negocio ("Se le debía $0.00", "A favor $31,620.00"). */
  saldoAnterior: string;
  /** Falta por saldar al corte: lo que se le debe (positivo) o saldo a favor. */
  faltaTexto: string;
  /** Separacion de los pedidos del socio de menudeo pendientes (solo en la semana en curso): 'Falta por saldar $X = deuda de la empresa $Y + pedidos de Angelo pendientes $Z'. */
  separacion: string | null;
  deudaEmpresaTexto: string | null;
}

/** En la hoja, positivo = se le debe al proveedor (convencion de la hoja); el libro se lee con la misma convencion. */
export function armarHojaProveedor(h: HojaProveedor, socio = 'Angelo'): HojaVM {
  const t = h.totales;
  const ambitoLibro = h.comprobaciones.libro_aplica;
  const cuadraConLibro = !ambitoLibro || h.comprobaciones.libro_igual_hoja;
  const ant = t.saldo_anterior_cent;
  const saldoAnterior = ant > 0n ? `Se le debía ${pesos(ant)}` : ant < 0n ? `A favor ${pesos(-ant)}` : 'Saldo cero';
  const falta = t.falta_por_saldar_cent;
  const faltaTexto = falta > 0n ? `Se le debe ${pesos(falta)}` : falta < 0n ? `A favor ${pesos(-falta)}` : 'Saldo cero';
  const libro = t.libro_al_corte_cent;
  const sello = !ambitoLibro ? 'Incluye partidas de fuera de la sociedad' : cuadraConLibro ? 'Cuadra con el libro' : `No cuadra con el libro: diferencia ${pesos(t.diferencia_libro_cent, true)}`;
  const nota = !ambitoLibro
    ? 'Con alcance "todo" la hoja suma partidas que el libro de la sociedad no lleva; la comparación con el libro solo aplica al alcance de la sociedad.'
    : cuadraConLibro
      ? `Saldo anterior (posición con el proveedor al inicio de la semana) + costo con guías − pagos − ajustes = saldo del libro al corte: ${pesos(libro, true)}.`
      : `El libro dice ${pesos(libro, true)} y la hoja ${pesos(falta, true)}: diferencia ${pesos(t.diferencia_libro_cent, true)}. Revisa movimientos del libro que la hoja no clasifica (diferencias de recepción, devoluciones, asientos manuales).`;
  const separa = h.totales.menudeo_vigente && h.totales.menudeo_pendiente_cent > 0n && falta > 0n;
  const separacion = separa ? `Falta por saldar ${pesos(falta)} = deuda de la empresa ${pesos(h.totales.deuda_empresa_cent)} + pedidos de ${socio} pendientes ${pesos(h.totales.menudeo_pendiente_cent)}` : null;
  const deudaEmpresaTexto = separa ? pesos(h.totales.deuda_empresa_cent) : null;
  return { cuadraConLibro, sello, nota, saldoAnterior, faltaTexto, separacion, deudaEmpresaTexto };
}
