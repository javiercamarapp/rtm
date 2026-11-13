# Contrato de la intención `pedido_dropshipping` (Telegram, para integrar después)

Estado: SOLO contrato. La rama del agente de Telegram NO se toca en esta entrega. Todo lo de abajo ya existe del lado SQL; falta cablear el agente.

## Principio rector

El destinatario (nombre, calle y número, colonia, CP, municipio, estado, teléfono, correo, referencias) NUNCA pasa por el modelo de IA, ni por Telegram, ni por Omar.
El bot crea el pedido SIN destinatario; los datos de entrega se capturan en la web (formulario protegido) o llegan como bloque que se redacta ANTES del modelo.

## Campos de la intención

| Campo | Tipo | Notas |
|---|---|---|
| `cliente` | texto | se resuelve por alias a `catalogo.cliente` (si es ambiguo, el bot pregunta) |
| `proveedor_origen` | `karen_directo` \| `karen_via_isaac` \| `isaac_directo` | por omisión `karen_directo` |
| `renglones` | lista de `{modelo, sabor, piezas}` (el precio sale del tabulador del cliente) | hasta 15 sabores y más de 100 piezas |
| `tipo_venta` | `cliente` \| `socio_a_costo` | a costo: exige `socio`; no admite envío cobrado, descuento ni crédito |
| `socio` | `Angelo` \| `Javier` | solo con `socio_a_costo` |
| `credito` | opcional `{tasa_semanal_bp, semanas \| fecha_pago, interes_cent}` | por omisión 10 % de UNA semana, simple; el cálculo lo hace SQL, nunca la IA |
| `folio_externo` | texto opcional | número de pedido del proveedor (por ejemplo 73266); también se registra después |
| `envio_cent`, `descuento_cent` | enteros | solo para `cliente` |

No hay campo de destinatario en la intención.

## Función SQL

`operacion.ds_crear_pedido(p_clave_idem, p_cliente_id, p_lineas, p_origen, p_destinatario => null, p_credito, p_tipo_venta, p_socio, p_folio_externo, p_envio_cent, p_descuento_cent, p_fecha, p_nota, p_mensaje_origen)`.

- Exige rol `socio` o canal `importacion`/`telegram` marcado por una función `agente.*`; con `p_destinatario` distinto de null exige rol `socio` de la WEB: desde Telegram falla con 42501 (probado en `030_dropshipping.test.sql`).
- Idempotente por `p_clave_idem` (update_id de Telegram). Devuelve costo estimado, venta estimada, margen estimado, interés y fecha de pago pactada. El bot repite esas cifras tal cual; no calcula.
- Pasos siguientes (todos con funciones existentes): `operacion.ds_registrar_folio` (folio del proveedor), `operacion.confirmar_pedido`, `operacion.enviar_pedido`, `operacion.ds_pagar_proveedor`.

## Confirmación reforzada

Antes de ejecutar, el bot muestra al grupo de los dos socios un resumen SIN datos de entrega: cliente, proveedor, piezas por modelo, costo, venta, margen, interés y fecha de pago.
La ejecución exige el botón de confirmación (token de un solo uso, flujo de la spec 26) de un socio. Los pedidos a costo para socio y los de crédito piden además segunda confirmación del otro socio (propuesta; decisión pendiente del dueño).

## Datos de entrega

Dos rutas, ambas fuera del modelo:

1. Enlace de captura en la web: el bot responde "Pedido P-0123 creado; captura el destinatario aquí: <enlace a /dropshipping/pedidos/<id>>". La captura usa `operacion.ds_capturar_destinatario` (solo web, rol socio).
2. Bloque redactado antes del modelo (a futuro): un filtro determinista en el webhook detecta el bloque de entrega por su formato, lo guarda con una función propia de canal `telegram` y sustituye el texto por `[destinatario capturado]` ANTES de entregar el mensaje al modelo. Hoy NO existe; no se debe construir con el modelo en el camino.

## Qué ve el agente

Nada del esquema `entrega`. El esquema está cerrado a `anon`, `authenticated` y a cualquier rol de IA (RLS forzada sin políticas). Las lecturas `api.ds_*` exigen rol `socio` y no incluyen datos del destinatario (solo si existe).
El agente de IA no calcula dinero: las cifras de cada respuesta salen de `api.ds_*`.


## Intención `pago_pedido_menudeo` (el socio avisa que pagó un pedido a costo)

Estado: SOLO contrato y función SQL; no se integra con la rama de Telegram en esta entrega.

| Campo | Tipo | Notas |
|---|---|---|
| `pedido` o `folio` | id o texto (por ejemplo P-0123) | debe ser un pedido a costo para un socio, ya enviado |
| `monto_cent` | entero | no puede exceder lo pendiente de pago (se descuentan los pagos ya reportados por confirmar); un pago parcial deja saldo pendiente |
| `referencia` | texto opcional (máx. 120) | clave de rastreo o folio de la transferencia o depósito |
| `fecha` | AAAA-MM-DD | por omisión hoy; no puede ser futura |
| `metodo` | `transferencia` \| `deposito` \| `efectivo` | por omisión `transferencia` |
| `via` | `proveedor` \| `sociedad` | pago directo al proveedor o abono a la sociedad |
| `socio` | `Angelo` \| `Javier` | quien avisa: lo pone el agente desde el miembro registrado, nunca el modelo |

- Función: `operacion.ds_reportar_pago_menudeo(p_clave_idem, p_pedido, p_folio, p_monto_cent, p_metodo, p_referencia, p_fecha, p_via, null, null, null, p_socio, p_nota)`. Llamable desde `agente.ejecutar_ext` en canal `telegram` (exige rol `importacion` o `socio`); es idempotente por `p_clave_idem` (update_id).
- La foto del ticket o la transferencia es SOLO evidencia: NUNCA pasa por la IA ni por Telegram. El bot no adjunta evidencia (la función lo rechaza con 22023 si llega desde un canal que no sea la web). Si el socio tiene el ticket, lo sube en la web (`/menudeo`), donde se guarda con huella sha256 en el esquema cerrado `entrega`.
- Confirmación reforzada: antes de ejecutar, el bot muestra al grupo el resumen (pedido, monto, método, referencia, fecha) y exige el botón de un socio (token de un solo uso). Quien confirma el aviso es el socio que reporta; el pago NO se aplica todavía.
- Política (decisión de diseño; confirmar con el dueño): un pago avisado por Telegram, sin evidencia, deja el pedido en estado `Pago reportado` y SIGUE pendiente de pago hasta que el OTRO socio lo confirme en la web (`api.ds_decidir_pago_menudeo`: confirmar recibido, que lo aplica; o rechazar con motivo). Si lo avisa el otro socio (el que recibe), se aplica de inmediato. Con evidencia adjunta en la web basta registrar.
- Solo los socios confirman o rechazan, y solo en la web (el bot no decide).
- Respuesta al grupo: el estado (`pago_reportado`) y el pendiente de pago que devuelve la función; el bot no calcula dinero.


## Intención `pedido_menudeo` (pedidos a costo del socio de menudeo, con fecha comprometida y recordatorios)

Estado: SOLO contrato y funciones SQL; el envío real por Telegram lo integra la rama de Telegram después.

**Solo la acepta del `socio_menudeo`** (parámetro de configuración, por omisión Angelo; su menudeo en Playa del Carmen). El agente VERIFICA el autor del mensaje (miembro registrado) antes de llamar a las funciones; si el autor no es el socio de menudeo, responde que solo ese socio mete pedidos a costo y no ejecuta nada. Las funciones lo refuerzan: `ds_crear_pedido` (a costo), `ds_reportar_pago_menudeo`, `ds_reprogramar_compromiso` y `ds_responder_recordatorio_menudeo` fallan con 42501 para otro socio. El otro socio solo supervisa (web) y confirma o rechaza pagos reportados.

Flujo:
1. **Crear.** Al crear un pedido a costo (`operacion.ds_crear_pedido` con `p_tipo_venta = 'socio_a_costo'`, `p_socio` = socio de menudeo) el bot pregunta «¿cuándo pagas?» y guarda fecha y hora (`p_fecha_compromiso`, `p_hora_compromiso`, ambas opcionales; sin fecha el pedido queda «sin fecha comprometida» y se muestra como alerta). Se puede fijar después con `operacion.ds_reprogramar_compromiso`.
2. **Recordatorios.** Una tarea del sistema llama a `operacion.ds_recordatorios_pago_menudeo(p_ahora)` (canal `importacion` o `telegram`; la web usa `api.ds_recordatorios_pago_menudeo`). Devuelve, sin datos personales (solo folio, socio, proveedor, monto pendiente, fecha, hora, días de atraso y número de recordatorios enviados):
   - `por_vencer`: el compromiso vence en las próximas `aviso_previo_horas` (24 por omisión) y aún no se avisó;
   - `vence_hoy`: venció hoy y no se avisó hoy;
   - `vencido`: venció antes de hoy; recordatorio periódico cada `intervalo_horas` (24 por omisión) hasta `max_recordatorios` (7) o hasta que se pague;
   - `sin_fecha`: alerta de pedido pendiente sin fecha comprometida (no consume recordatorios).
   La configuración (`api.ds_recordatorio_config`, `api.ds_recordatorio_config_guardar`) la editan los socios y queda registrada.
3. **Registrar el envío.** Tras mandar el mensaje, `operacion.ds_registrar_recordatorio_menudeo(clave, pedido, tipo, enviado_at, 'telegram')`: idempotente por pedido y hora (misma hora, no duplica).
4. **Responder.** Al vencer el bot pregunta «¿ya pagaste?» con botones **Pagado** / **Reprogramar**: `operacion.ds_responder_recordatorio_menudeo(clave, pedido, 'pagado' | 'posponer', fecha, hora, motivo, referencia, metodo, via, socio)`. «Pagado» reporta el pago por todo lo pendiente SIN evidencia: queda «Pago reportado» y el pedido sigue pendiente de pago hasta que el otro socio lo confirme en la web (ver `pago_pedido_menudeo`). «Reprogramar» exige motivo y queda en el historial de reprogramaciones.
5. **Destinatarios.** Los recordatorios periódicos se mandan SOLO al grupo de los dos socios, nunca a terceros. Nunca llevan datos de clientes ni del destinatario.

Confirmación reforzada: crear el pedido, reportar el pago y reprogramar piden el botón de confirmación del socio de menudeo (token de un solo uso). Las cifras (monto pendiente, atraso) las calcula SQL; el modelo de IA no calcula dinero ni fechas.
