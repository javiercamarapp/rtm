# Correccion de precios por modelo de pedidos enviados

Decision del dueno (14-nov): "ponle el precio a cada modelo, hazlo de tal manera que cuadre con el precio de venta". Tres pedidos de dropshipping con Isaac, enviados el 2026-11-12, tenian un precio plano por pieza en todos los renglones. Eso dejaba renglones bajo costo aunque cada pedido ganaba en total. Cambia solo el REPARTO del precio entre modelos; el total de venta de cada pedido no se mueve.

## Como se registra el ingreso (lo que se encontro)

Leido de `contabilidad.lineas_de_evento_base`: la venta entra al libro desde la NOTA del pedido (Dr 1210 total, Cr 4110 subtotal, Cr 4300 envio, Cr 4910 recargo, Dr 4210 descuento), por pedido (`pedido_id`) y SIN dimension de modelo. El modelo solo viaja en el costo (5100 e inventario). Consecuencia: repartir el mismo subtotal entre modelos de otra forma no cambia ningun asiento. No hace falta reversar ni rehacer asientos, y no se hizo: el libro (hash encadenado, eventos inmutables) queda intacto. Lo que si guarda el precio por modelo es:

1. `operacion.pedido_linea.precio_cent`, de donde leen los reportes de venta y utilidad por modelo, y
2. la nota (documento al cliente), que se corrige con el mecanismo oficial `operacion.emitir_correccion` (nota C1 enlazada a la original; su asiento neto es cero, asi que no genera asiento).

## Funcion oficial

Migracion aditiva `20261115400000_correccion_precio_por_modelo.sql`:

- `operacion.corregir_precio_por_modelo(p_clave_idem, p_pedido, p_precios jsonb, p_detalle)` y su envoltorio `api.corregir_precio_por_modelo` (solo `authenticated`; adentro `seguridad.exigir_rol(['socio'])`; Omar, bodega y anon no pueden).
- `p_precios` es un objeto `{"<modelo>": <centavos enteros>}` (clave: nombre del modelo o su id). Exige un precio para cada modelo del pedido y ninguno de mas.
- Valida que `suma(piezas surtidas x precio nuevo)` sea IGUAL al subtotal de la ultima nota; si no, falla (`23514`) y no escribe nada.
- Pedido que no esta enviado, sin nota o con devoluciones de cliente: se rechaza (`P0428`).
- Cada renglon del modelo recibe el precio del modelo, `motivo_precio = 'correccion de precio por modelo'` y `precio_tabulador_cent` = tabulador vigente del cliente (null si no existe).
- Emite la nota de correccion (`<folio>-C<n>`), verifica que el total de la nota no cambie, y deja un evento `correccion_precio_modelo` (antes y despues por modelo) mas un registro en `seguridad.auditoria`.
- Idempotente por clave (mismo contenido devuelve lo guardado; otro contenido es conflicto `P0409`). Si todos los renglones ya estan al precio pedido responde `sin_cambio` sin escribir.
- Trigger T4 de `pedido_linea` (la linea enviada es inmutable): ahora permite cambiar UNICAMENTE `precio_cent`, `precio_tabulador_cent` y `motivo_precio` mientras la funcion tiene el interruptor de transaccion `rtm.correccion_precio = 'on'`. Todo lo demas (piezas, costo, renta, borrado) sigue prohibido.
- La funcion de `operacion` no es ejecutable por la web (revoke explicito).

Se puede volver a corregir (otra distribucion con el mismo total): cada correccion agrega una nota y no borra nada.

## Que se preserva (probado en pgTAP)

Totales de nota, por cobrar, pagos aplicados, saldo del cliente, posicion con Isaac, costo, kardex, utilidad por pedido, recargo, numero de asientos y de lineas, hash de cabecera y mayor por cuenta, comprobaciones C1..C24 y CU, Libro conciliado, cadena de hash integra. Cero asientos nuevos.

## Datos privados (fuera del repo)

Regla del repo: ningun dato real de ventas. Los folios, modelos, piezas, precios y totales reales NO estan en el repo: viven en un archivo JSON privado (permisos 600, carpeta 700) que se pasa con `--datos <ruta>` y que el script valida con zod. Formato, en pesos enteros:

```json
{ "<folio>": { "total_pesos": 0, "precios": { "<modelo>": 0 }, "piezas": { "<modelo>": 0 } } }
```

`total_pesos` es el subtotal de mercancia (sin envio ni recargo de credito, que no se tocan); `piezas` es opcional y se compara contra la base. Se rechaza todo lo que no cuadre: la suma `precio x piezas` debe ser igual a `total_pesos` y al subtotal vigente de la ultima nota. Ejemplo FICTICIO: `test/fixtures/cargador/precios-por-modelo-ejemplo.json`. Los precios reales de los tres pedidos de Isaac del 12-nov estan en el archivo privado entregado al dueno (no en el repo), con el criterio: los del primer pedido salen de las notas originales del dueno; los de los otros dos los eligio Claude con margen uniforme sobre el costo y deben confirmarse antes de aplicar. Los costos se leen de `costo_unit_cent` de los renglones.

## Como correrlo (despues del despliegue de la migracion)

```
export DATABASE_URL=<rol propietario de produccion>   # del gestor de secretos; nunca en el repo
node scripts/cargador/corregir-precios-por-modelo.mjs --datos <ruta del JSON privado> --verificar
node scripts/cargador/corregir-precios-por-modelo.mjs --datos <ruta del JSON privado> --aplicar
node scripts/cargador/corregir-precios-por-modelo.mjs --datos <ruta del JSON privado> --verificar
node scripts/cargador/cuadre.mjs --objetivo <objetivo.json>
```

`--verificar` es solo lectura (transaccion `read only`) y muestra antes y despues por modelo, los totales que no cambian y los renglones bajo costo. `--aplicar` usa SOLO la funcion oficial, una transaccion por pedido, compara los totales antes y despues dentro de la transaccion y la revierte si algo cambia; es idempotente (segunda corrida: "repetido"). Efectos al aplicar: una nota de correccion por pedido y su aviso (`nota_corregida_o_anulada`, canales software y Telegram segun los interruptores). Reversa: otra correccion con los precios que se quieran; ningun dato se borra.

El despliegue de la migracion no provoca builds de Vercel (se compila en local y se sube prebuilt); la correccion misma es solo SQL por la funcion oficial y no despliega nada.

## Pruebas

`supabase/tests/database/a12_001_correccion_precio_por_modelo.test.sql` (65 pruebas, datos sinteticos con el mismo patron): totales identicos antes y despues, C1..C24 y CU sin cambio, suma exacta, rechazos, idempotencia, permisos (Omar, bodega, anon), T4 sigue cerrado, ida y vuelta. `test/unit/cargador/correccion_precios.test.ts` (vitest, datos ficticios): validacion zod del archivo, cuadre, conversion a centavos, que el script no escribe con SQL directo y que el repo no lleva folios reales.
