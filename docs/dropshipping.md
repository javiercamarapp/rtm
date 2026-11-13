# Dropshipping

Definición del dueño (13-nov): DROPSHIPPING = vendemos directo del proveedor (Karen/Vapemate, también Isaac) y el proveedor envía de SU stock al cliente; no entra inventario a la bodega de Mérida.

## Modelo (todo aditivo; no cambia ningún pedido existente)

- `origen_surtido` = `dropshipping` | `inventario_merida`, DERIVADO del origen que ya existía (`operacion.origen_surtido`): `karen_directo`, `karen_via_isaac` e `isaac_directo` son dropshipping; `bodega_omar` y `castores`, inventario en Mérida.
- `operacion.pedido_ds` (1:1): proveedor, tipo de venta (`cliente` | `socio_a_costo`), socio, folio externo del proveedor (único por proveedor, buscable).
- `operacion.pedido_credito`: porcentaje semanal, semanas, fecha de pago pactada, modo (`simple` por omisión, `compuesto` o `fijo`), base e interés. El interés se aplica como el recargo por crédito del pedido (`pedido.recargo_cent`): nota, asientos y cuentas por cobrar lo recogen sin cambios. Calculado por SQL (`operacion.interes_credito`) con espejo en TS (`src/dominio/dropshipping/calculos.ts`); nunca por IA.
  Por omisión: 10 % de UNA semana, interés SIMPLE (el dueño no ha confirmado simple vs compuesto; está documentado y `compuesto` es una opción explícita), sobre el total de la mercancía menos el descuento (sin envío). Ejemplo: 200 pzas x 130.00 = 26,000.00 a una semana al 10 % => interés 2,600.00, total 28,600.00. Se puede capturar otro porcentaje, otras semanas, una fecha de pago o un monto pactado fijo por venta.
- `operacion.ds_amortizacion`: cada pago al proveedor puede ligarse a un pedido (informativo). La posición con el proveedor es `operacion.ds_posicion_proveedor` = cuenta corriente menos el costo de los directos enviados; los pagos parciales amortizan primero el costo.
- Esquema `entrega` (destinatarios): `entrega.destinatario` y `entrega.revelacion`, RLS forzada sin políticas, sin privilegios para `anon`, `authenticated` ni Omar. Solo funciones SECURITY DEFINER de rol socio. Teléfono y correo salen enmascarados; revelar (y copiar la orden con el bloque completo) queda auditado. Nada del destinatario entra a eventos, resultados de idempotencia ni a la IA. No está cifrado en reposo (el dueño aceptó "cifrado o acceso restringido"; hoy es acceso restringido).
- `operacion.texto_orden_proveedor` / `api.ds_orden_proveedor`: arma el texto de la orden por marca y modelo con sabores y cantidades y el bloque de destinatario. Sin E/S externa: el sistema NO escribe a Karen ni a clientes.

## Contabilidad

El libro ya asentaba los pedidos directos (venta, costo de venta 5100/5110, cuenta por pagar al proveedor 2110/2120). Este módulo no crea asientos nuevos: `Libro conciliado` (C1..C24, CU1..CU3) se probó en verde tras cada escenario (a)-(h) en `030_dropshipping.test.sql`.

### Utilidad

Utilidad = venta (con el envío cobrado como ingreso y el interés) MENOS todo el costo del pedido: producto, seguro de reenvío, envío del proveedor y costos directos. Es la de la nota interna y la del Estado de resultados; se reparte 50/50 (`catalogo.socio.participacion_ppm`; el primer socio recibe el redondeo medio hacia arriba y el segundo el resto).
La utilidad del PERIODO es además menos lo que no es de un pedido (mermas, regalos a costo, servicios, ajustes con proveedores). `api.ds_conciliacion` y `032_dropshipping_utilidad_estado_resultados.test.sql` prueban que suma de utilidades por pedido + otros = utilidad neta del Estado de resultados.
El envío de una compra de inventario se capitaliza al costo del inventario y sale a costo de ventas al venderse (probado en 032).

### Utilidad reinvertida en el proveedor

Si el cliente deposita la venta en la cuenta del proveedor, el costo liquida el pedido y el excedente queda como saldo a favor: utilidad reinvertida, mitad por socio (`reinvertida` = depositado por encima del costo, topado por la utilidad). Solo cuenta como reinvertida lo respaldado por utilidad; el resto del saldo a favor se muestra como ANTICIPO al proveedor, con aviso.
DISEÑO SIN DOBLE CONTEO: el módulo no asienta capital. La utilidad pasa por el resultado del periodo y se vuelve capital del socio SOLO por el acta de corte (reinversión: socio_libro 'reinversion' + aportación capital, cuentas 3310/3320 a 3110/3120, ya corregida en `20261113300200`). El reporte mensual muestra la reinversión del acta y ofrece el monto reinvertido en el proveedor como "Sugerido para el acta". La valuación ya cuenta el saldo a favor con el proveedor como activo; al firmar el acta el capital aportado sube y la valuación total no cambia (probado en 031).
Un retiro real solo existe por acta (por socio y por mes), no por pedido.

### Pedidos a costo para un socio

Ingreso = costo, utilidad 0; no admite envío cobrado, descuento ni crédito; sin cuenta por cobrar si se paga directo al proveedor. Cuentan en "Piezas movidas a proveedores" (total, por proveedor, por socio y por mes).

## Migraciones y GRANT a `authenticated`

- `20261113400000_dropshipping_modelo.sql`: tablas, esquema `entrega`, vistas internas. Sin GRANT (todo revocado a public, anon y authenticated).
- `20261113400100_dropshipping_funciones.sql`: escrituras `api.ds_crear_pedido`, `api.ds_capturar_destinatario`, `api.ds_registrar_folio`, `api.ds_pagar_proveedor`; lecturas `api.ds_interes`, `api.ds_catalogo`, `api.ds_pedidos`, `api.ds_desglose`, `api.ds_resumen`, `api.ds_ficha`, `api.ds_destinatario`, `api.ds_destinatario_revelar`, `api.ds_orden_proveedor`, `api.ds_cuenta_proveedor`, `api.ds_por_cobrar`, `api.ds_explicar`.
- `20261113400200_dropshipping_utilidad.sql`: `api.ds_utilidad`, `api.ds_reporte_mensual`, `api.ds_explicar_utilidad`, `api.ds_conciliacion`.
- `20261113400300_dropshipping_aportacion_neta.sql`: `api.socios_aportacion_neta`.
Todas las `api.*` listadas tienen `grant execute ... to authenticated` y exigen rol `socio` dentro; ninguna otra función ni tabla tiene GRANT. No se hace DROP de ningún objeto existente.

## Interfaz

Sección Dropshipping del menú lateral con pestañas Resumen, Pedidos, Nuevo pedido, Pagos al proveedor, Por cobrar y Utilidad; ficha de pedido en `/dropshipping/pedidos/<id>`; en `/pedidos` el filtro Todos / Dropshipping / Inventario en Mérida con columna de surtido y desglose; en Cuenta de socios, Aportación neta y diferencia a igualar. Cada cifra clave abre "Explicar este número" (`ds:` y `dsu:`).

Telegram: ver `docs/dropshipping-telegram-contrato.md`. Fondos en poder: ver `docs/dropshipping-fondos-en-poder-decision.md`.
