// Glosario de "Explicar este numero": definiciones cortas y fijas de los terminos que aparecen en las fichas. Sin cifras ni datos del negocio.
export interface Termino { termino: string; definicion: string }

export const GLOSARIO: Readonly<Record<string, Termino>> = {
  existencia: { termino: 'Existencia', definicion: 'Piezas físicas que hay en una ubicación: entradas menos salidas registradas en el libro de movimientos.' },
  kardex: { termino: 'Kardex', definicion: 'Libro de movimientos de inventario de un modelo, con su saldo corrido después de cada entrada o salida.' },
  costo: { termino: 'Costo', definicion: 'Lo que cuesta cada pieza según el proveedor vigente. Un costo marcado como supuesto aún no está confirmado por una compra.' },
  margen: { termino: 'Margen', definicion: 'Ganancia por pieza: precio al cliente menos costo del proveedor.' },
  utilidad_bruta: { termino: 'Utilidad bruta', definicion: 'Ventas netas más envío cobrado, menos el costo de lo vendido.' },
  utilidad_contribucion: { termino: 'Utilidad de contribución', definicion: 'Utilidad bruta menos los gastos variables de venta (guías, mensajeros, comisiones).' },
  utilidad_neta: { termino: 'Utilidad neta', definicion: 'Lo que queda después de todos los costos y gastos del periodo.' },
  valuacion: { termino: 'Valuación', definicion: 'Valor de la empresa a costo: activos menos deudas. El inventario nunca se valúa a precio de venta.' },
  liquidez: { termino: 'Liquidez', definicion: 'Dinero disponible de la sociedad: efectivo, banco y fondos en poder de los socios.' },
  posicion: { termino: 'Posición con un proveedor', definicion: 'Saldo neto con el proveedor según el libro: positivo es a favor de la sociedad, negativo es lo que se le debe.' },
  por_cobrar: { termino: 'Cuenta por cobrar', definicion: 'Importe de pedidos entregados que el cliente aún no paga.' },
  saldo: { termino: 'Saldo', definicion: 'Suma acumulada de los cargos y abonos de una cuenta hasta la fecha de corte.' },
  partida_doble: { termino: 'Partida doble', definicion: 'Cada asiento carga y abona el mismo importe; por eso el libro siempre cuadra consigo mismo.' },
  libro_mayor: { termino: 'Libro mayor', definicion: 'Todos los movimientos de una cuenta contable, en orden, con su saldo corrido.' },
  dos_vias: { termino: 'Comprobación por dos vías', definicion: 'La cifra se calcula dos veces por caminos distintos. Si las dos coinciden, cuadra; si no, hay algo por revisar.' },
  estimado: { termino: 'Estimado', definicion: 'Cifra proyectada con un modelo. Se muestra con su rango y la muestra mínima; sin historia suficiente no se emite.' },
  aportacion: { termino: 'Aportación de capital', definicion: 'Dinero que un socio declara expresamente como inversión. Lo demás que un socio pone o paga es reembolso.' },
  reembolso: { termino: 'Reembolso', definicion: 'Dinero que un socio puso por la empresa y que se le devuelve; es una cuenta por pagar, no capital.' },
  retiro: { termino: 'Retiro', definicion: 'Utilidad o capital que un socio saca de la sociedad.' },
  capital_aportado: { termino: 'Capital aportado', definicion: 'Aportaciones declaradas, reinversiones de utilidad y apertura, menos retiros de capital.' },
  utilidades_retenidas: { termino: 'Utilidades retenidas', definicion: 'Utilidad ya asignada a un socio que todavía no retira.' },
  renta_devengada: { termino: 'Renta devengada', definicion: 'Renta de bodega generada por día de uso, aunque todavía no se pague.' },
  cobertura: { termino: 'Cobertura', definicion: 'Días que alcanza la existencia al ritmo de venta reciente.' },
  devolucion: { termino: 'Devolución', definicion: 'Piezas que regresan: el crédito al cliente o al proveedor se compensa con lo que vuelve a inventario.' },
  cascada: { termino: 'Cascada de utilidad', definicion: 'Camino de la utilidad del periodo hasta lo que le toca a cada socio.' },
  libro_conciliado: { termino: 'Libro conciliado', definicion: 'Las identidades contables (auxiliar contra mayor, partida doble y efectivo repartido) se cumplen todas.' },
  paquete: { termino: 'Paquete perdido o dañado', definicion: 'Incidente de envío: define qué parte del costo absorbe cada quien y su efecto en la utilidad.' },
};

export function terminosDe(claves: readonly string[]): Termino[] {
  return claves.map((c) => GLOSARIO[c]).filter((t): t is Termino => t !== undefined);
}
