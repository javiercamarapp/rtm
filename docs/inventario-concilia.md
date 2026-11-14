# Inventario: «Concilia con el libro» y conteos con sabores nuevos

`api.inventario_concilia()` (migración `20261114500200`, solo socio) alimenta el panel de `/inventario` y `/inventario/conteo`: kárdex valorizado contra la cuenta 1310, piezas del kárdex contra la existencia mostrada, y el último conteo cerrado con diferencias por sabor y estado (`Conciliado`, `Con diferencias abiertas` si hay diferencias sin explicar, `Sin conteo físico todavía`).

Conteo con sabores no surtidos: la hoja incluye todos los sabores de los modelos con existencia (esperado 0) y un socio puede crear un sabor desde la hoja. En `cerrar_conteo` el valor del ajuste por modelo es el del costo promedio de las piezas netas: diferencias que suman 0 (por ejemplo +10/-10, +3/-17/+14) no cambian el valor del inventario; pgTAP `a11_003` lo comprueba y verifica que el Libro conciliado y las comprobaciones siguen igual. Un conteo real que difiere por sabor (por ejemplo 14 sabores contra los 10 del sistema) se carga por su propio flujo, no por este trabajo.

## Conteo en cero de un modelo con varios SKUs (corrección, migración 20261114500300)

`operacion.cerrar_conteo` redondeaba cada salida por separado: al vaciar un modelo con costo promedio fraccionario (por ejemplo 1,040 piezas con 95,220.78 en 10 sabores, o 33+33+34 con 10,000.01) la suma no era el valor total y fallaba con «valor de salida inconsistente con el inventario». Ahora la última salida de un modelo que se vacía toma el residuo exacto. pgTAP `a11_004` cubre ambos casos, un conteo parcial y uno con entradas (neto 0).
