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
