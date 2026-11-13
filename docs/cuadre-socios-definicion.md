# Cuadre de Socios: que significa "Libro conciliado" (definicion por escrito)

Fuente de las reglas: investigacion/31-LOGICA-DEL-DINERO-ENTRE-SOCIOS.md (y adendas 32 y 33). Implementacion: `operacion.cuadre_socios()` (migracion 20261113300100); se muestra en `/socios` (indicador Libro, con "Explicar este numero" `socios:cuadre`).

## Por que cambio
La senal anterior ("Cuadra" = lo puesto por Angelo + lo puesto por Javier = costo de la compra) no es una identidad contable: da falso "No cuadra" en estados legitimos (la sociedad paga con su caja, pagos parciales pendientes con el proveedor, depositos de socios aun sin gastar). Mezclaba ademas un dato de negocio pendiente de decidir (de quien es el efectivo de la caja) con la salud del libro. Un verificador independiente la reprodujo con cinco escenarios.

## Libro conciliado = se cumplen TODAS estas identidades
Ninguna depende de una cifra elegida de antemano ni del parametro `caja_sociedad_cuenta_puesto_pct`.

(i) Auxiliar contra mayor, por socio y por concepto (cuenta del socio = su cuenta en el libro):
- Reembolsos por pagar: cuenta 2310/2320 = aportado reembolsable + reembolsos pagados (negativos).
- Capital y utilidades por distribuir: 3110/3120 + 3310/3320 - retiros 3210/3220 = capital aportado + libro del socio sin reembolsos - lo que queda fuera de la sociedad.
- Fondos de la sociedad en poder del socio: 1150/1160 = cuenta del socio (fondos).
- Faltantes por cobrar al socio: 1170/1180 = cuenta del socio (faltantes).

(ii) Partida doble:
- Balanza: suma del debe = suma del haber en todo el libro; ningun asiento descuadrado.
- Ningun movimiento de socio o de caja (aportacion, cuenta del socio, libro del socio, efectivo) con evento sin asiento (cuando el evento produce renglones).
- Ninguna comprobacion bloqueante en rojo, y en verde C7, C8 y C24 (proveedores, socios, cajas por persona) cuando existen.

(iii) Doc 31, "suma de los saldos de los socios = efectivo de la sociedad repartido":
- (a) El efectivo del que parte la Cascada (suma de las cajas) es el que dice el libro (1101 + 1102).
- (b) La identidad de la Cascada (`operacion.cascada_calcular`, campo `identidad`) con el efectivo real: lo asignado a los socios (reembolsos + utilidad repartible - anticipos) = efectivo repartido (efectivo total - remanente), y los resultados de los socios mas lo que tienen en su poder y lo que deben sin ser efectivo suman lo mismo. Si el efectivo es negativo la Cascada no se puede calcular y la senal queda en falso con ese motivo.

Definicion minima adoptada para (iii): el doc 31 nombra la identidad pero no da su formula contable completa; se adopto la que ya vive en la Cascada (la que la propia pantalla muestra como "Identidad por dos vias") mas la comprobacion de que parte del efectivo del libro. No se inventa ninguna regla de negocio: no se fija reserva minima, ni el destino de cobros en efectivo, ni el valor del parametro de caja. Limitacion honesta: (b) es aritmetica de la asignacion (detecta reparticiones que no suman y efectivo negativo); lo que ata la Cascada a los libros es (a) y (i).

## Etiquetas
- Libro conciliado: todas las identidades se cumplen y no se debe nada a proveedores.
- Libro conciliado · pendiente de pago al proveedor: se cumplen todas y todavia se debe a proveedores (no es una falla).
- Revisar el libro: alguna identidad no se cumple; "Explicar este numero" lista cada verificacion con sus dos lados.

## Diferencia por la compra (informativa)
Via 1 = lo puesto por Angelo con su dinero para la compra - la mitad del costo; via 2 = (Angelo - Javier) / 2. Ya NO es la senal de salud. "Puesto para la compra" cuenta pagos a proveedores con dinero propio y compras o guias pagadas por el socio (neto de lo que tiene en su poder de la sociedad y de lo que queda fuera de la sociedad); NO cuenta depositos a la caja de la empresa (esten o no gastados), ni gastos de operacion, ni reinversion de utilidades. Desglose que siempre suma el costo: dinero propio de los socios + caja de la sociedad + fondos de la sociedad en poder de un socio + pendiente con proveedores + otros (apertura, ajustes, pedidos directos).

## Parametro pendiente del dueno
`caja_sociedad_cuenta_puesto_pct` (0 a 100, por omision 0, sin decidir): fraccion de lo que la caja de la sociedad pago al proveedor que se atribuye por mitades iguales como "puesto por los socios". Solo mueve la cifra informativa; nunca la salud.
