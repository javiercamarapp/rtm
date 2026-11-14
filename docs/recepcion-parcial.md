# Recepcion parcial de compras

Estado: migracion `20261114600000_recepcion_parcial_guarda_y_bot.sql` sobre la mecanica de `20261113900100` (funciones) y `20261113900400` (API).

## Que hace el sistema

- Una compra se recibe en varias llegadas. Cada llegada indica por renglon (modelo y sabor) cuantas piezas llegaron AHORA (`api.recibir_compra_parcial`, rol socio).
- Cada llegada crea su lote, sus movimientos de kardex por sabor y su asiento (inventario 1310 contra mercancia en transito 1320) por lo efectivamente recibido.
- La compra queda `recibida_parcial` con el saldo pendiente por renglon (`api.compra_recepcion`: facturadas, recibidas, pendientes, valor que entro, costo puesto). La pantalla de la compra lo muestra y ofrece "Registrar una llegada parcial".
- Si con una llegada todos los renglones quedan completos, la recepcion se cierra sola, sin diferencias.
- Si no va a llegar el resto, "Cerrar la recepcion" (`api.cerrar_recepcion_compra`, exige motivo): lo que falta se vuelve una diferencia `faltante` con el costo puesto no reconocido, en la cuenta puente 1340 (por reclamar al proveedor o por asignar). No es inventario.

## Guardas

| Caso | Resultado |
|---|---|
| Llegada que suma mas de lo facturado del renglon (ya recibido + ahora) | P0435 "no se recibe mas de lo pedido" (base y pantalla) |
| Compra anulada, borrador, recibida o cerrada | P0428 |
| Compra directa al cliente | P0428 |
| Renglon ajeno a la compra, sabor de otro modelo, piezas no positivas | 22023 |
| Cerrar con faltante sin motivo | 23502 |
| Repetir la misma clave | devuelve lo ya registrado (no cae en la guarda ni duplica) |

Nada se edita ni se borra: cada llegada es un lote nuevo; el cierre es un evento aparte. No existe deshacer una llegada; una correccion se hace con contramovimiento (merma, ajuste o devolucion al proveedor), igual que antes.

## Regla de costo (sin cambios)

Costo puesto de un renglon = (mercancia + guia + seguro) / piezas FACTURADAS, con guia y seguro prorrateados por piezas facturadas y el residuo en el ultimo renglon. Cada llegada reconoce `round(puesto x recibido acumulado / facturadas)` menos lo ya reconocido: la suma de las llegadas es exactamente el costo puesto cuando se completa, y el costo unitario de lo ya recibido NO cambia cuando llegan mas piezas o cuando se cierra con faltante.

Ejemplo (caso tipo Nexa, en chico): 100 pz a 100.00, sin guia. Llegan 88 y se cierra: inventario 8,800.00 (88 x 100.00), faltante de 12 pz por 1,200.00 en la cuenta puente.

Nota para el dueno: la regla NO divide el costo entre las piezas recibidas. Si se quisiera que las 12 faltantes encarezcan las 88 recibidas (costo = total / recibidas), seria un cambio de regla contable y de costo promedio; no se hizo.

## Telegram (`compra_recepcion`)

- Con renglones dictados (`/recibir C-0002 | jupiter/uva 30`): recepcion PARCIAL. La compra queda abierta; antes de esta migracion el bot cerraba la compra con faltantes.
- Sin renglones: si la compra aun no recibe nada, recepcion total como siempre; si ya esta `recibida_parcial`, recibe solo el saldo pendiente de cada renglon.
- La tarjeta de confirmacion muestra la llegada (piezas ahora, acumuladas, pendientes) y el estado resultante; ese efecto entra al hash de la vista previa, de modo que si otra llegada se registra entre la vista previa y la confirmacion, se aborta (P0462).
- El bot no cierra recepciones con faltante ni deshace llegadas: eso se hace en el software (no se abrio escritura nueva).
- Misma regla de exceso: P0435.

## Pruebas

- pgTAP `supabase/tests/database/a11_001_recepcion_parcial_guarda_y_bot.test.sql` (30 pruebas: guarda, llegadas sucesivas, cierre con faltante, bot, idempotencia, identidades C4/C5/C18/C19).
- Vitest `test/unit/devoluciones.test.ts` (`armarLlegada`: rechaza exceso, acepta exacto).
- Existentes que siguen verdes: 028, 030, 007, a8_001.
