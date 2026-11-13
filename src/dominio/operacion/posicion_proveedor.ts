// Posicion con un proveedor: UNA sola verdad en pantalla. Es la del libro (cuenta 2110 o 2120), la misma de Inicio, Contabilidad y Capital.
// Nada aqui calcula dinero: solo redacta, con la lengua del negocio, las cifras que ya entrega la base (api.proveedor_cuenta y api.proveedor_hoja).
import { formatearMoneda } from '../formato';
import type { CuentaProveedor, HojaProveedor } from './tipos';

export type TonoPosicion = 'debe' | 'favor' | 'cero';

export interface PosicionProveedorVM {
  tono: TonoPosicion;
  /** Frase del encabezado: "Se le debe a Karen $53,250.00". */
  titular: string;
  /** Monto sin signo, en pesos. */
  monto: string;
  palabra: 'Se le debe' | 'A favor de la sociedad' | 'Saldo cero';
  /** Una linea: costo de pedidos y compras menos pagos y abonos igual a la posicion. */
  desglose: string;
  /** Anticipo (prepago) como detalle, no como saldo: solo cuando la posicion es a favor. */
  anticipo: string | null;
  /** Reconciliacion de la lista movimiento por movimiento (cuenta corriente) con la posicion. */
  reconciliacion: { cuentaCorriente: string; otrosCargos: string; posicion: string; texto: string };
  /** Libro y auxiliar dicen lo mismo. */
  cuadra: boolean;
}

const pesos = (c: bigint, conSigno = false): string => formatearMoneda(c, conSigno ? { conSigno: true } : {});
const abs = (c: bigint): bigint => (c < 0n ? -c : c);

export function armarPosicionProveedor(c: CuentaProveedor): PosicionProveedorVM {
  const pos = c.posicion_cent;
  const d = c.posicion;
  const tono: TonoPosicion = pos < 0n ? 'debe' : pos > 0n ? 'favor' : 'cero';
  const palabra = tono === 'debe' ? 'Se le debe' : tono === 'favor' ? 'A favor de la sociedad' : 'Saldo cero';
  const titular = tono === 'debe' ? `Se le debe a ${c.proveedor} ${pesos(abs(pos))}` : tono === 'favor' ? `A favor de la sociedad con ${c.proveedor} ${pesos(pos)}` : `Saldo cero con ${c.proveedor}`;
  const resultado = tono === 'debe' ? `se le debe ${pesos(abs(pos))}` : tono === 'favor' ? `a favor ${pesos(pos)}` : 'saldo cero';
  const desglose = `Costo de pedidos y compras ${pesos(d.cargos_cent)} − pagos y abonos ${pesos(d.abonos_cent)} = ${resultado}`;
  const anticipo = tono === 'favor' ? `Anticipo pagado por adelantado, aún sin consumir con pedidos: ${pesos(pos)}` : null;
  const otros = c.saldo_cent - pos;
  const texto = `Movimientos de la cuenta ${pesos(c.saldo_cent, true)} − costo de pedidos directos y otros cargos del libro ${pesos(otros)} = posición ${pesos(pos, true)}`;
  return {
    tono, titular, monto: pesos(abs(pos)), palabra, desglose, anticipo,
    reconciliacion: { cuentaCorriente: pesos(c.saldo_cent, true), otrosCargos: pesos(otros), posicion: pesos(pos, true), texto },
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
}

/** En la hoja, positivo = se le debe al proveedor (convencion de la hoja); el libro se lee con la misma convencion. */
export function armarHojaProveedor(h: HojaProveedor): HojaVM {
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
  return { cuadraConLibro, sello, nota, saldoAnterior, faltaTexto };
}
