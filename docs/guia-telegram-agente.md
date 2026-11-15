# Guia del agente de Telegram para Angelo y Javier

Para que los dos socios manden por Telegram lo que pasa con el dinero y el agente lo REGISTRE, para cuadrar cuentas entre ustedes. Todo lo de esta guia se probo con el simulador del agente (modelo simulado, sin Telegram real). Nada se ha enviado ni encendido.

## Reglas que el agente nunca rompe

1. La IA solo lee el mensaje y extrae campos (quien, cuanto, a quien, concepto). Nunca suma ni calcula dinero: si un monto no esta escrito en el mensaje, el codigo lo bloquea y el agente pregunta. Los totales y saldos los calcula la base de datos.
2. Antes de registrar cualquier movimiento de dinero el agente muestra un RESUMEN ("Todavia no se registro nada") con dos botones, Confirmar y Cancelar. Solo registra cuando un socio pulsa Confirmar. Omar no puede confirmar.
3. Si falta un dato (monto, a quien, cuenta, via de pago, folio del pedido), pregunta. No supone nada.
4. El mismo mensaje no se registra dos veces (idempotente por mensaje y por boton de un solo uso).
5. Todo se puede revertir con "deshacer" (o `/deshacer`). Queda un contramovimiento; el original no se borra.
6. Cada movimiento queda en la cadena de auditoria con el canal "telegram" y quien lo mando (`telegram:<persona>: <cita del mensaje>`), mas el folio del evento.
7. El bot solo habla en el grupo de los dos socios (y en el chat privado de Omar para su lista cerrada). Nunca escribe a clientes. La IA nunca ve telefonos. Hay tope de gasto de IA por dia y por mes; al llegar, el bot pasa a modo sin IA y solo entiende comandos.

## Como se manda cada cosa

Se puede escribir con tus palabras o con comando (los comandos funcionan aunque la IA este apagada). Los montos van en pesos; "20 mil" y "20,000" valen lo mismo.

| Que registras | Ejemplo de mensaje | Comando | Que responde |
|---|---|---|---|
| Gasto de un socio | "pague 500 de guia" | `/gasto guia 500 javier` | Resumen del gasto y de quien lo pago. Al confirmar: folio G-, "Reembolso pendiente a Javier" (el gasto es de la empresa una sola vez y la empresa le debe el reembolso). |
| Cobro a un cliente | "Cliente Norte pago 7,000 en efectivo" | `/pago Cliente Norte \| 7000` | Si no dices la cuenta pregunta "a que cuenta entro el pago (Angelo, Javier, Isaac, Karen o efectivo)". Resume y, al confirmar, muestra el saldo que calcula el servidor. |
| Pago de un cliente directo al proveedor | "Cliente Norte mando 30,500 a Karen" | `/pagoprov karen \| 30500 \| sociedad` | Baja lo que debe el cliente y sube el saldo a favor con Karen. |
| Pago a proveedor de un socio | "pague 30,500 a Karen" | `/pagoprov karen \| 30500 \| javier` | Resume y registra; baja primero lo que ese socio debia a la sociedad y el resto cuenta como aportacion. |
| Reembolso a un socio | "le pague a Javier 1,000 de reembolso por transferencia" | `/reembolso javier 1000 transferencia` | Resume. La base rechaza un reembolso mayor a lo que se le debe. Pregunta la via (transferencia o efectivo) si no la dices. |
| Retiro de utilidad | "retiro 4,000 de utilidad en efectivo" (el socio es quien escribe) | `/retiro angelo 4000 efectivo` | Solo sale de la utilidad ya asignada por el corte; si pides mas, la base lo rechaza y lo dice. |
| Deposito o aportacion | "puse 1,000 para gastos" | `/aporte javier 1000` | Sin declararlo capital queda como REEMBOLSO (cuenta por pagar al socio) y el resumen lo dice. |
| Aportacion de capital declarada | "meti 20,000 de capital para invertir" | `/aporte javier 20000 capital` | Solo si lo dices (capital, invertir, "meti mas lana para invertir"). Resumen: "capital que declaro el socio". |
| Devolucion de un cliente | "Cliente Norte devolvio 5 jupiter del pedido P-0001 a inventario" | `/devolucion Cliente Norte \| P-0001 \| jupiter 5 \| inventario` | DEPENDE de la rama de devoluciones. Hoy responde que se hace en el software (ver "Dependencias"). |
| Paquete perdido o danado | "el paquete del pedido P-0003 se perdio" | `/paquete perdido P-0003` | DEPENDE de la rama de paquetes. Igual que la devolucion. |
| Deshacer | "deshaz" | `/deshacer` o `/deshacer G-0001` | Revierte el ultimo movimiento que mandaste (o el folio) con contramovimiento. Si ya paso mas de la ventana o tiene dependencias, pide un segundo toque. |

### Consultas (no piden confirmacion)

| Pregunta | Mensaje | Comando |
|---|---|---|
| Estado de cuenta de un socio | "estado de cuenta de Javier" | `/estado javier` |
| Cuenta entre socios | "saldo de socios" | `/saldo socios` |
| Utilidad del mes (o hoy, semana) | "utilidad del mes" | `/utilidad mes` |
| Cuanto debe cada cliente | "cuanto debe cada cliente" | `/cartera` |
| Por pagar de la empresa (Isaac, Karen y la renta de Omar, cada uno aparte, y el total) | "cuanto debemos", "por pagar" | `/porpagar` |
| Saldo de un cliente o proveedor | "saldo de Cliente Norte", "saldo con Karen" | `/saldo Cliente Norte` |
| Existencias por modelo | "cuanto hay de jupiter" | `/stock jupiter` |

La utilidad es una aproximacion operativa; la cifra contable esta en el software (Contabilidad).

### Segunda entrega: casi todo lo util del sistema desde el chat

Cada fila es una intencion del catalogo declarativo (`src/dominio/agente/catalogo_intenciones.ts`: intencion, puerta SQL, nivel de confirmacion, quien puede, si tiene reversa). La IA solo clasifica y extrae campos (esquema zod estricto por intencion); jamas genera SQL ni calcula dinero. Antes de pedir confirmacion, el servidor SIMULA la operacion (`agente.simular`, se revierte siempre) y el resumen muestra su efecto real: precios del tabulador, importes, saldos y el cuadre por dos vias. Si la base no aceptaria la operacion, se rechaza en ese momento, antes de escribir.

| Que haces | Mensaje o comando | Confirmacion | Deshacer |
|---|---|---|---|
| Crear pedido (precio del tabulador, lo pone el sistema; el PLAZO es obligatorio: si no lo dices el bot pregunta antes de escribir, ver `docs/plazo-obligatorio.md`) | `/pedido Cliente \| modelo/sabor 24 \| plazo contado` (o `plazo 15 dias`) o "Cliente: 24 modelo/sabor, de contado" | normal | si, mientras no este enviado (se cancela) |
| Pedido enviado o entregado | `/enviado P-0001 [guia]`, `/entregado P-0001`, "se envio el pedido P-0001" | normal | no directo: se corrige en el software |
| Cancelar pedido con motivo | `/cancelar P-0001 \| motivo` | reforzada | no |
| Cobro de nota o pago de cliente | `/pago Cliente \| 7000` o "Cliente pago 7000 en efectivo" | normal | si |
| Registrar compra (costo de lista del proveedor, lo pone el sistema) | `/compra isaac \| modelo/sabor 50` | normal | si (se anula) |
| Orden de compra en borrador | `/oc karen \| modelo/sabor 100` y luego `/aprobar C-0001` | normal | si (borrador) |
| Paquete de compra en trayecto o llego a Merida | `/enviada C-0001`, `/llego C-0001` | normal | no directo |
| Recepcion total o parcial | `/recibir C-0001` (total) o `/recibir C-0001 \| modelo/sabor 30` (parcial) | normal | no directo |
| Pago de socio al proveedor | `/pagoprov isaac \| 5000 \| javier` | normal | si |
| Cargo de servicio con tipo de cambio | `/servicio openrouter 20usd javier [tc 18.50]` o `/servicio vercel 500 javier` o "pague 20 usd de openrouter" | normal | si |
| Merma con motivo | `/merma modelo/sabor 2 \| caja danada` | normal | si |
| Conteo fisico (ajusta existencias) | `/conteo modelo/sabor 12 \| modelo/sabor 4` | reforzada | no |
| Alta de cliente (sin telefonos) | `/cliente Nombre` | normal | no |
| Precio de un cliente en el tabulador | `/precio Cliente \| modelo \| 250` | normal | no |
| Propuesta de acta de corte y reinversion | `/acta [AAAA-MM] [retira angelo 1000] [reinvierte javier 500]` | reforzada | no (se anula desde el software) |
| Firma del acta | `/firmaracta [folio]` | reforzada | no |
| Movimientos historicos con fecha pasada | `/lote etiqueta` + `total 900` (opcional) + una linea por movimiento | reforzada, con vista previa | si, renglon por renglon por su folio |
| Reembolso, retiro de utilidad, aportacion, gasto de socio | como en la primera entrega | normal | si |
| Devolucion de cliente, paquete perdido o danado | `/devolucion`, `/paquete` | contrato listo | espera sus ramas (P0461) |

Consultas, sin confirmacion: `/cuadra` (comprobaciones por dos vias), `/socios` (saldo de cada socio), `/utilidad [hoy|semana|mes]`, `/balance`, `/diario`, `/cobertura [modelo]`, `/stock [modelo]`, `/cartera`, `/compras`, `/pedidos`, `/reporte [hoy|semana|mes]` (el resumen sale en el grupo; no se envia ningun correo), `/pendientes` ("que falta por hacer": pedidos por enviar o cobrar, compras por recibir, ordenes por aprobar, tomas de Omar por autorizar, actas por firmar), `/ayuda`.

**Confirmacion**. Todo movimiento muestra un resumen y no se registra hasta que un socio pulsa Confirmar (caduca en 24 horas). Las acciones reforzadas piden un SEGUNDO si ("Si, estoy seguro") y antes dicen con todas sus letras si hay o no deshacer. Si falta un dato (cuenta, via, quien pago) se pide con botones y despues sigue el resumen; si falta un folio o un motivo se pide por texto. Una suma dictada que no cuadra con los renglones (por ejemplo `total 1000` en un lote que suma 900) bloquea todo y pide correccion; ambas cifras las calcula el codigo. Una cifra que la IA propone y no esta en el mensaje del socio tambien bloquea.

**Autor y firma**. El autor de cada operacion es el socio que escribe (`agente.ejecutar` y `agente.ejecutar_ext` exigen autor). La firma del acta es personal: la da quien la pide, con su propio Telegram; si otro socio pulsa Confirmar no se firma. El bot nunca firma por un socio ni por los dos.

**Movimientos historicos y apertura**. `/lote` acepta gasto, cobro, aportacion, reembolso y retiro con fecha pasada explicita (AAAA-MM-DD). Muestra la vista previa del servidor con el cuadre por dos vias, pide confirmacion reforzada y escribe cada renglon con su propia clave (reenviar el lote completo no duplica nada). Los saldos iniciales de la sesion de apertura (inventario inicial, cuentas por cobrar, capital) siguen en la sesion de apertura del software, que tiene su propio ensayo y firma de ambos socios; el chat no la sustituye.

### Tercera entrega: igualación de aportaciones, menudeo del socio y recordatorios (decisiones del dueño, 13-nov)

Tres piezas nuevas. Todo se probó con el simulador, con pgTAP y de punta a punta contra la base local con Telegram simulado (fetch falso): nada se envió a Telegram.

**1. Comentario de igualación.** Después de CUALQUIER aportación, pago de un socio a un proveedor con dinero propio, reembolso, cobro en cuenta de socio o retiro registrado por el bot, el bot comenta en el grupo, con datos de la base (nunca calculados por la IA):

- `Javier lleva $47,921.91 más aportado; el siguiente pago le toca a Angelo.` (quien tiene más aportado y a quién le toca el siguiente pago), o
- `Aportaciones igualadas.` cuando no hay diferencia.

La fuente es `agente.igualacion()` (lectura de solo servidor, sin GRANT a authenticated) que llama a `api.socios_aportacion_neta()`, la misma definición de aportación neta, diferencia a igualar y turno que usa `api.capital_por_mes` (pgTAP a7_001 comprueba que coinciden y reproduce el ejemplo del dueño: 118,161.91 contra 70,240.00, diferencia 47,921.91). No se duplicó lógica. Sin lenguaje de deuda: la diferencia no es una deuda ni un reembolso a favor del otro. Si la lectura falla, el movimiento ya registrado no se afecta y queda un evento. También comenta tras un lote histórico que traiga aportaciones, reembolsos, retiros o cobros en cuenta de socio. No comenta tras un gasto, un cobro en efectivo ni un pago de la sociedad.

**2. Intención `pedido_menudeo`** (solo la acepta el `socio_menudeo` configurado, por omisión Angelo; el autor se verifica por su id de Telegram en TypeScript y otra vez en SQL):

| Qué haces | Mensaje o comando | Qué pasa |
|---|---|---|
| Pedido a costo para tu menudeo (Playa del Carmen) | `/pedidomenudeo [karen\|isaac] \| modelo/sabor 24 \| cuando el viernes 5pm` o "pedido menudeo: 10 elux/sandia, pago el viernes" | Si no dices cuándo pagas, el bot pregunta «¿Cuándo pagas este pedido?» y contestas con tus palabras («el viernes», «mañana a las 5 de la tarde», «20 de noviembre», «sin fecha»). El resumen muestra la fecha interpretada y el costo que calcula la base; confirmas tú. |

- La fecha la interpreta el CÓDIGO (`src/dominio/agente/fecha_pago.ts`, hora de Mérida, UTC-6), nunca la IA: el modelo solo copia la frase en `cuando_texto` (y el código exige que esa frase esté en tu mensaje) y su esquema estricto NO tiene campos de fecha. Ante la duda pregunta con botones: una hora sin am/pm («mañana a las 5») ofrece 5:00 y 17:00; «el viernes» siendo viernes ofrece hoy o la semana siguiente; una fecha pasada o ilegible se vuelve a preguntar (3 intentos y suelta la pregunta sin registrar nada). Reglas de fechas: una fecha con mes sin año («5 de noviembre», «5/11») que ya pasó NO se corre en silencio al año siguiente (se rechaza como pasada; solo «el 5» pasa al mes siguiente y el resumen siempre muestra la fecha completa); «viernes 20» respeta el 20 y, si no cae en viernes, se pide aclaración; años de uno o dos dígitos («15/11/2», «15/11/26») o a más de un año («2099») no se entienden. Las opciones las elige quien pidió; si pulsa el otro socio no pasa nada y vuelven las opciones.
- El pedido lo crean las funciones `ds_*` (`operacion.ds_crear_pedido`, tipo `socio_a_costo`; luego `confirmar_pedido`) y guarda `fecha_compromiso_pago` con su hora y quién la comprometió. El destinatario y los teléfonos NUNCA pasan por la IA ni por Telegram: el esquema no tiene campos para ellos, el esquema `entrega` queda vacío y el bot lo dice («los datos de entrega se capturan en la web»). El cliente interno del pedido es «Menudeo <socio>» (sin teléfonos), lo pone la base; no lo elige la IA.
- Un pedido sin fecha queda «sin fecha comprometida» (alerta en la web). Se deshace con `/deshacer` mientras no esté enviado; para enviarlo, `/enviado P-0001`.
- Si el otro socio (Javier) lo manda, el bot responde que solo Angelo mete pedidos a costo y no ejecuta nada (evento `menudeo_otro_socio`); aunque se invoque la puerta SQL directo, falla con `42501`. Omar no puede.

**3. Intención `pago_pedido_menudeo`** (el socio de menudeo avisa que pagó un pedido a costo):

| Qué haces | Mensaje o comando | Qué pasa |
|---|---|---|
| Aviso de pago | `/pagopedido P-0001 \| 1000 \| [transferencia\|deposito\|efectivo] \| [proveedor\|sociedad] \| [ref CLAVE] \| [ayer]` o "pagué 1,000 del pedido P-0001 ref ABC ayer" | Pregunta lo que falte (monto, folio; si pagaste directo al proveedor o abono a la sociedad, con botones). Muestra el resumen con el pendiente que calcula la base. |
| Comprobante | mandar la foto (sola o con el comando en el pie de foto) | Se guarda SOLO como evidencia: su `file_id` y su huella (sha256 del `file_unique_id`) en `agente.evidencia_tg`. El bot no descarga ni lee la imagen, la IA nunca la ve y no se guarda en `entrega.evidencia_pago`. Vale 30 minutos y se liga a un solo pago. |

- Política (la ya definida): **sin comprobante** queda «Pago reportado» y el pedido sigue pendiente hasta que el OTRO socio lo confirme con el botón **Confirmar recibido** (o lo **Rechace**); **con comprobante** basta registrar y se aplica (el bot NO verifica el comprobante: decisión del dueño), y la tarjeta al otro socio dice «Pago aplicado con comprobante; puedes rechazarlo» con el botón **Rechazar**; el otro socio todavía puede **Rechazar** (se anula y el pedido vuelve a pendiente). Quien reportó no se confirma a sí mismo (la tarjeta vuelve; la base también lo exige con `42501`).
- Una sola decisión por reporte; el rechazo desde el botón guarda el motivo fijo «Rechazado desde Telegram por el otro socio (sin motivo detallado)» (la base exige motivo); un motivo propio se captura en la web.
- Un monto mayor al pendiente lo rechaza la base y no se registra nada. Doble envío de la misma indicación o doble pulsación: idempotente.

**4. Recordatorios de pago (tarea del latido).** `/api/tareas/latido` (con `TAREAS_SECRETO`) llama, en cada pasada, a `enviarRecordatoriosMenudeo()`:

- Con el interruptor `telegram_envio` **APAGADO** (como nace) no envía NADA ni reclama nada: los avisos siguen pendientes para cuando se encienda.
- Con el interruptor encendido lee `ds_recordatorios_pago_menudeo(ahora)` y manda al **GRUPO de socios** (nunca a terceros, ni a Omar, ni a clientes): **24 h antes** (aviso informativo), **al vencer** y **cada 24 h** después hasta que se pague o se lleguen a **7 recordatorios** (valores configurables en la web). Al vencer y en los vencidos el mensaje pregunta «¿Ya pagaste?» con botones **Pagado** (reporta el pago pendiente, sin comprobante, y avisa al otro socio con la tarjeta de confirmar) y **Reprogramar** (pregunta la nueva fecha con texto, la interpreta el código y se confirma con un botón; queda en el historial con el motivo «Reprogramado desde Telegram a petición del socio de menudeo»).
- Solo el socio de menudeo responde esos botones; si pulsa el otro, no pasa nada y la tarjeta vuelve.
- El mensaje lleva solo folio, socio, proveedor, monto pendiente, fecha y días de atraso: nada de clientes ni de entrega.
- Idempotencia: cada aviso se RECLAMA en la base antes de enviarse (`agente.recordatorio_reclamar`, que revalida que ese aviso todavía toca y registra el envío con `ds_registrar_recordatorio_menudeo`, único por pedido y hora). Dos latidos simultáneos o un reintento no duplican. Defensa en profundidad: `agente.recordatorio_reclamar` también comprueba en SQL que `telegram_envio` está encendido (si no, `reclamado = false`), y si ya hay un aviso de ese pedido en la misma hora de reloj (la ventana única de la base no distingue tipo) no reclama otro: por ejemplo, `por_vencer` y `vence_hoy` en la misma hora no se duplican y el segundo sale en la hora siguiente. Contrapartida documentada: si Telegram falla justo después de reclamar, ese aviso no se reenvía (queda un evento `recordatorio_error`; los vencidos se repiten al día siguiente). Con un pago ya reportado por confirmar, o sin fecha comprometida, no se manda recordatorio al chat (queda como alerta en la web).

### Lo que NO hace

- Nunca escribe a clientes ni a terceros: todo va al grupo de los dos socios. No envia correos ni reportes por correo.
- La IA no ve telefonos ni correos (se ocultan antes del prompt) y nunca calcula dinero.
- Omar no registra nada por esta via (solo toma piezas y consulta lo suyo); no ve costos ni contactos.
- Fotos y audios: se avisa que se recibieron pero no se leen (no hay ruta de transcripcion de notas de voz en esta rama); el socio escribe el dato.
- Devoluciones y paquete perdido: contrato listo, no se registran hasta integrar sus ramas.
- Los datos de entrega de un pedido de menudeo (destinatario, teléfono) y la lectura del comprobante: nunca por Telegram ni por la IA; se capturan en la web.
- Un motivo de rechazo propio de un pago reportado y el pago con comprobante en PDF dentro del chat (solo se guarda la huella de lo que mande): se hacen en la web.
- Apertura (saldos iniciales firmados), cierre de periodos contables y asientos manuales: en el software.
- No hay reversa directa de envios, recepciones, conteos, altas, precios ni actas: el agente lo dice antes de confirmar.

## Ejemplo de conversacion

```
Javier: pague 500 de guia
Bot:    Resumen para confirmar. Todavia no se registro nada. Lo pidio Javier.
        Movimiento: Gasto
        Concepto: guia
        Monto: $500.00
        Lo pago: Javier (queda como reembolso pendiente a ese socio)
        [Confirmar] [Cancelar]
Angelo: (pulsa Confirmar)
Bot:    Registrado G-0001 por Javier, confirmado por Angelo ... Reembolso pendiente a Javier: $500.00
Javier: le pague a Javier lo que le debiamos
Bot:    De cuanto fue el reembolso?     (no inventa la cifra)
```

## Dependencias de otras ramas

- Devolucion de cliente: necesita `operacion.registrar_devolucion_cliente` (rama `lane/devolucion-parcial`, migraciones 20261113000100 a 20261113000400).
- Paquete perdido o danado: necesita `operacion.reportar_paquete_salida` (rama `lane/paquete-perdido`, migracion 20261112400000).
- Mientras no esten en la base, `agente.ejecutar` responde el codigo P0461 y el bot dice que se hace en el software; no se duplica ninguna de esas funciones. Al integrarlas hay que (1) agregar la llamada en `agente.ejecutar` (resolviendo folio de pedido y lineas) y (2) cambiar `NegocioAgenteDb` para usarla. `agente.capacidades()` ya informa cuales existen. El contrato (intenciones, esquema, comandos, resumen y espejo en el simulador) ya esta probado.
- Migraciones de esta rama (aditivas): `20261113100000_telegram_agente_socios.sql` y `20261113100100_telegram_agente_ampliado.sql` (agente.ejecutar_ext, agente.simular, agente.consulta_ext, deshacer ampliado y actor del canal telegram).
- Prueba que conectara devolucion y paquete: `test/integracion/telegram_e2e.test.ts` (caso "devolucion y paquete perdido") FALLA a proposito cuando `agente.capacidades()` informe la funcion, para obligar a conectar la llamada en `agente.ejecutar`, en `preparar` de `src/infra/agente/postgres.ts` y a cambiar el contrato a `activa`.

## Encender el bot real (lo hace Javier; no se imprime ni se inventa ningun secreto)

Todo esto es configuracion privada: nunca va al repo, al chat ni a un mensaje.

1. **Bot**: en Telegram, hablar con BotFather, `/newbot`. Guardar el token que entrega SOLO en la variable privada `TELEGRAM_BOT_TOKEN` del entorno de despliegue (o de `.env.local` para pruebas locales). Con `/setprivacy` dejar el bot en modo que pueda leer el grupo (o hacerlo administrador).
2. **Grupo**: crear un grupo con los dos socios y el bot. Omar NO va en ese grupo; Omar solo habla con el bot en privado.
3. **Ids**: obtener el id numerico de Angelo, de Javier, de Omar, del grupo y del chat privado de Omar (por ejemplo con un bot de consulta de ids propio de confianza, o leyendo el campo `from.id` y `chat.id` de un update en los registros del webhook). Dejarlos en la variable privada `TELEGRAM_MIEMBROS` como JSON con las claves `angelo`, `javier`, `omar`, `grupo_socios`, `privado_omar` (ids enteros distintos de cero).
4. **Registrar miembros**: `node scripts/agente/registrar-miembros.mjs --dry-run` valida el JSON sin escribir ni imprimir ids; despues, sin `--dry-run`, con `SERVIDOR_DATABASE_URL` apuntando a la base correcta, los registra en `agente.miembro` y `agente.chat_registrado`. Omar queda registrado sin permisos de socio.
5. **Secreto del webhook**: generar una cadena larga aleatoria (por ejemplo `openssl rand -hex 32`) y guardarla en `TELEGRAM_WEBHOOK_SECRET`. Sin secreto configurado el webhook rechaza todo.
6. **IA**: `OPENROUTER_API_KEY` en el entorno privado. Sin ella el bot funciona en modo sin IA (solo comandos).
7. **setWebhook**: con el token y el secreto en variables del shell (sin pegarlos en el historial), llamar a `setWebhook` de la API de Telegram con la URL publica `https://<dominio>/api/telegram/webhook` y el parametro `secret_token` igual a `TELEGRAM_WEBHOOK_SECRET`. Telegram enviara el secreto en la cabecera `X-Telegram-Bot-Api-Secret-Token`.
8. **Interruptores**: `telegram_envio` nace apagado en `seguridad.interruptor`; hay que encenderlo para que los avisos salgan al grupo. Encender la tarea de latido (`TAREAS_SECRETO`) para caducar tomas.
9. **Prueba**: en el grupo, `/ayuda`, luego un gasto chico con `/gasto guia 1 javier`, Confirmar y `/deshacer`.
10. **Costos**: el despliegue y los builds de Vercel tienen costo; la regla vigente es avisar cuantos builds provoca antes de empujar. Esta rama no toco nada de eso.

Rotar token y secreto si alguna vez se pegaron en un chat o en un repo.

## Decisiones del dueño que NO se inventaron (valores configurables)

- Cuanto de la caja de la sociedad cuenta como puesto por los socios: no se asume. Hoy la base exige efectivo en la caja de la empresa para reembolsar (el chat lo rechaza en la vista previa con ese motivo) y el orden de fondeo es el de las reglas del repo.
- Dinero propio de un socio que paga a Isaac: reembolso salvo que declare invertir o reinvertir (regla del 11-nov). Por omision es reembolso; capital solo con las palabras "capital" o "invertir". Para cambiarlo, es el parametro `intencion` de `operacion.registrar_aportacion` y la rama de `pago_proveedor_de_socio`; no esta cableado a una configuracion externa todavia.
- Reserva minima de inventario, tipo de cambio por omision (hoy el ultimo registrado en `costos.tipo_cambio`; si no hay, el agente pregunta).

## Plan de prueba con el bot real (cuando el dueño entregue token, ids y secreto)

1. Registrar miembros y chats sin imprimirlos (`npm run agente:registrar -- --dry-run`, luego sin `--dry-run`), fijar el webhook con `secret_token` y dejar `telegram_envio` apagado.
2. En el grupo: `/ayuda`, `/cuadra`, `/pendientes`. Debe responder solo a los dos socios; un tercero y Omar en el grupo no reciben respuesta.
3. Un gasto chico: `/gasto guia 1 javier` -> resumen -> Confirmar (quien lo pidio; si pulsa el otro socio no se registra y la tarjeta vuelve) -> folio -> `/deshacer`.
4. Un pedido de prueba contra un cliente de prueba con precio de tabulador: verificar el importe del resumen contra el tabulador, confirmar, `/enviado`, cobro, `/cuadra` debe decir "Las cuentas cuadran".
5. Un lote historico de 2 renglones: vista previa, Confirmar (quien lo pidio), segunda confirmacion (el OTRO socio), revisar en la web que las fechas son las dictadas; `/deshacer` por folio.
6. Acta: `/acta`, firma de cada socio con `/firmaracta` desde su propio Telegram; verificar que el segundo socio no puede firmar por el primero.
7. Mensaje de Omar en privado con un comando de socio: debe quedar bloqueado y avisar al grupo.
8. Confirmar en el panel de Telegram que ningun mensaje salio a un chat distinto del grupo y del privado de Omar.

## Politicas de seguridad (revision independiente, 13-nov)

**Quien es el autor (ALTO-1).** La base no confia en el campo `autor` del JSON. Toda escritura (`agente.ejecutar`, `agente.ejecutar_ext`, `agente.simular`, `agente.deshacer`) exige que el autor exista en `agente.miembro` como persona con rol `socio` y activo, y que el `telegram_user_id` que manda TypeScript (el del remitente que verifico el webhook) sea el de esa persona; si no, `42501`. La firma del acta (`acta_firma`) exige ademas el boton "Si, estoy seguro" consumido por ESE socio, de ESA indicacion (misma clave): el id de quien pulso queda en `agente.tg_token.usado_por`. Los ayudantes internos (`agente._*`, incluidas las funciones base `_ejecutar_base` y `_ejecutar_ext_base` que no tienen candados) no tienen EXECUTE para el rol `servidor`; solo las puertas lo tienen. Limite honesto: quien tenga la credencial del rol `servidor` puede seguir invocando las puertas con el id de un socio real; esa credencial es la unica raiz de confianza.

**Quien puede deshacer (MEDIO-1).** El solicitante es un socio verificado y es el actor de la anulacion; el hecho guarda `deshecho_por`. Un socio deshace SUS hechos cuando quiera (la base decide si la anulacion es posible); un hecho DEL OTRO socio solo dentro de los 10 minutos siguientes (corregir un error visible en el grupo, como el boton Deshacer); pasado ese tiempo solo lo deshace quien lo registro, o se corrige en el software. Una toma de Omar (T-) la resuelve cualquier socio. `/deshacer` sin folio toma el ultimo hecho PROPIO. `dependenciasDe` es un stub que devuelve 0 (B1): la proteccion contra dependientes la dan las propias funciones de anulacion de la base, que rechazan con un motivo en espanol.

**Que efecto se confirma y quien confirma (MEDIO-2).** La vista previa devuelve el hash del efecto que calculo el servidor (precios del tabulador, tipo de cambio, totales); el boton Confirmar lo lleva y la ejecucion recalcula el efecto real: si es otro (cambio el precio, el tipo de cambio o la existencia entre simular y ejecutar) se aborta todo con `P0462` y se pide un resumen nuevo. Por omision el AUTOR confirma lo suyo (Confirmar, "Si, continuar" y "Si, estoy seguro"): si pulsa el otro socio no se registra nada y la tarjeta vuelve a mostrarse; el otro socio si puede cancelar, completar un dato faltante o elegir una opcion de aclaracion. Un segundo socio NO es obligatorio, salvo en las acciones de `SEGUNDO_SOCIO_OBLIGATORIO` (hoy solo el lote historico), cuyo segundo paso lo da el otro socio. La firma del acta es personal.

**Mensajes reenviados (MEDIO-3).** Un reenviado es dato no confiable: sus `/comandos` se ignoran y, si se interpreta con IA, solo admite consultas; cualquier escritura se rechaza con un aviso.

**Orden de reclamos (MEDIO-4).** El mensaje se reclama por (chat, mensaje) ANTES del limite de frecuencia: un mensaje rechazado por frecuencia queda reclamado y su edicion posterior no se procesa como nuevo. El mensaje actual cuenta en la ventana (el limite es "mas de N por minuto").

**Precios dictados (MEDIO-5).** Convencion de Mexico (`parsearPrecio`): `1,250.50`, `1250.5`, `$1,250` son precios; `1.250`, `1.250,50` y `1,5` son ambiguos y el agente pide escribirlo sin ambiguedad antes de confirmar. Nunca se adivina.

**Capital (decision del dueno, 13-nov).** El dinero propio de un socio que paga a un proveedor es REEMBOLSO por omision; es capital solo si el socio lo declara expresamente (capital, invertir, reinvertir, meter mas lana), verificado contra su mensaje y mostrado con su texto citado. La intencion manda `declara_capital: true` a `agente.ejecutar`; mientras `operacion.pago_proveedor_de_socio` no tenga el parametro `p_declara_capital` (lane/cuadrar-cuentas), la base responde `P0461` en vez de registrarlo como reembolso.

**Folios (B2).** La vista previa corre en un sub-bloque que se revierte; los folios salen de `seguridad.contador_folio` (se actualiza dentro de la transaccion), asi que simular NO deja huecos de folio (pgTAP 031 lo comprueba).

**Webhook (B3).** La ruta valida el secreto ANTES de leer el cuerpo, rechaza por `Content-Length` mayor a 1 MB sin leer y corta la lectura al pasar el tope.

## Politicas de la tercera entrega (menudeo, igualacion y recordatorios)

- **Quien manda.** `pedido_menudeo`, `pago_pedido_menudeo` y las respuestas a recordatorios las acepta SOLO el `socio_menudeo` (`agente._exigir_socio_menudeo`, con la misma regla de autor verificado contra `agente.miembro` y `telegram_user_id`). La decisión sobre un pago reportado la toma SOLO el otro socio (`ds_decidir_pago_menudeo`).
- **Privilegios.** Ninguna función nueva tiene GRANT a `authenticated`: las `agente.*` nuevas (`igualacion`, `socio_menudeo`, `envio_activo`, `espera_abrir`, `espera_tomar`, `evidencia_guardar`, `recordatorios_menudeo`, `recordatorio_reclamar`) son solo del rol `servidor`; los ayudantes `_*` no los ejecuta nadie. Las tablas `agente.tg_espera` y `agente.evidencia_tg` tienen RLS forzada y sin GRANT. Se redefinieron (create or replace, misma firma, sin DROP) `agente.ejecutar_ext` y `agente.simular` (solo enrutan los tipos nuevos y conservan firma del acta, segundo socio del lote y hash del efecto) y `operacion.ds_reportar_pago_menudeo` (un comprobante de Telegram, solo huella, cuenta como evidencia; conserva sus privilegios).
- **Efecto confirmado.** La vista previa del pedido (costo, fecha comprometida) y del pago (pendiente, estado) lleva hash; si el efecto real cambia entre simular y ejecutar, la base aborta con `P0462`.
- **Preguntas abiertas.** Una por socio (`agente.tg_espera`), caduca a los 30 minutos, se toma una sola vez y solo la contesta quien la recibió; un mensaje reenviado o un comando no la contestan.
- **Migraciones aditivas** (prefijo 20261113700000 en adelante): `20261113700000_telegram_igualacion.sql`, `20261113700100_telegram_menudeo_estado.sql`, `20261113700200_telegram_menudeo_puertas.sql` y `20261113700300_telegram_socio_menudeo.sql` y `20261113700400_telegram_reclamar_endurecido.sql` (correcciones de la verificación independiente). Un botón ya usado, caducado o reenviado responde «Esa tarjeta ya se usó o caducó.» sin registrar nada.

## Verificacion independiente (13-nov, sobre e942121)

- **La tarjeta no supone la clasificacion: la lee de la base.** `agente.simular` y `agente.ejecutar`/`ejecutar_ext` devuelven `clasificaciones` (lo que dejaron, o dejarian, las filas de `operacion.aportacion_socio`: capital o reembolsable, monto y socio). La tarjeta de vista previa dice "El sistema lo registrara como ..." y el eco de resultado "Registrado como ..." con esos datos. Si la base fuera a registrar CAPITAL sin que el socio lo declarara con sus palabras, el agente NO lo registra y lo explica.
- **ORDEN DE INTEGRACION: lane/cuadrar-cuentas (migracion 20261113300000: reembolso por omision y `p_declara_capital`) va ANTES que esta rama.** En la base de main, `operacion.pago_proveedor_de_socio` registra como capital el dinero propio del socio; por eso hoy un pago de un socio a un proveedor se rechaza en la vista previa con ese motivo, y declarar capital da P0461 (en la vista previa y en la ejecucion, por el mismo camino). Al integrar cuadrar-cuentas el rechazo desaparece solo y la tarjeta mostrara "reembolso (cuenta por pagar al socio)", o "CAPITAL" solo con declaracion expresa. Las pruebas pgTAP 031 y 032 funcionan con y sin la funcion de 9 argumentos.
- **El capital lo declara cada socio por si mismo** (decision de diseno): un socio no registra capital a nombre del otro (aportacion, pago a proveedor o renglon de un lote), ni por IA ni por comando; SQL (`agente._exigir_capital_propio`) y TypeScript lo rechazan. El deposito del otro socio SIN declarar capital si se registra, como reembolso. La declaracion se verifica contra el mensaje original, tambien por renglon de un lote (la linea que lleva su fecha, o el mensaje completo), y la tarjeta muestra la declaracion de cada renglon.
- **Lote historico, segundo socio tambien en SQL:** `agente.ejecutar_ext('lote_historico')` exige el boton "Si, estoy seguro" consumido por el OTRO socio, de esa misma indicacion. Con un solo autor se rechaza (42501) aunque se invoque la puerta directo.
- **`agente.resolver_toma`** recibe y verifica al socio que pulsa (como `ejecutar` y `deshacer`); la version sin verificar se elimino. `caducar_tomas` es una tarea del sistema (latido), sin autor.
- **Montos ambiguos (`1.250`)** se piden aclarar en TODA intencion con dinero (cobro, gasto, aportacion, pago a proveedor, acta, lote...), no solo en el precio de un pedido; `1,250.50` y `1250.50` pasan.
- **Telefonos:** `redactarContactos` oculta tambien `(999) 123-4567`, `999 - 123 - 4567` y `(999)1234567` (parentesis y separadores de 1 a 3 caracteres; la coma no es separador, asi que los montos como `1,250.50` no se tocan).
- **Origen de los eventos:** el gasto guarda `telegram:<socio>: <cita>` con un solo prefijo (la funcion de negocio ya lo antepone).
- **Privilegios:** revoke/grant explicito por funcion en la migracion; `alter default privileges ... revoke ... from public` NO protege funciones futuras (PUBLIC conserva el EXECUTE de fabrica), asi que la proteccion es ese revoke/grant por funcion mas la prueba pgTAP 032 que falla si alguna funcion de `agente` queda abierta a PUBLIC, anon o authenticated.
- **Riesgo documentado (BAJO-2):** `agente.registrar_miembro` y `agente.registrar_chat` tienen EXECUTE para el rol `servidor` porque `scripts/agente/registrar-miembros.mjs` los usa. Quien tenga la credencial de `servidor` puede registrar un id de Telegram como socio y, con el, firmar como ese socio; esa credencial es la raiz de confianza y no debe salir del servidor. Mitigacion futura posible: llamar esas dos funciones solo con una credencial aparte de uso unico y quitarles EXECUTE a `servidor`.

## Como se probo

- `supabase/tests/database/a7_001_telegram_igualacion.test.sql` y `a7_002_telegram_menudeo.test.sql` (pgTAP): igualación contra `api.capital_por_mes` con el ejemplo del dueño, pedido de menudeo (autor verificado, solo el socio de menudeo, hash, doble envío, sin destinatario), pago reportado con y sin comprobante, decisión del otro socio, esperas, interruptor, recordatorios (por vencer, vence hoy, vencidos, máximo de 7, reclamo idempotente), respuesta a recordatorios, cuadre de socios y privilegios.
- `test/unit/agente/fecha_pago.test.ts` y `agente.menudeo.test.ts`: interpretación de fechas en lenguaje natural y cada intención (feliz, faltante, fecha ambigua, otro socio, interruptor apagado, doble envío, recordatorio repetido, Pagado y Reprogramar, comprobante, guardas de cifras).
- `test/integracion/telegram_menudeo_e2e.test.ts`: lo mismo de punta a punta contra la base local (Telegram con fetch falso; nada sale a api.telegram.org).
- Simulador del menudeo (EN MEMORIA, no es para `simular-telegram.mts`, que va contra la base local): `npx tsx scripts/agente/simulador.mts scripts/agente/guion-menudeo.txt` (comandos nuevos del guion: `foto <quien>`, `envio on|off`, `latido`).
- `test/unit/agente/agente.socios.test.ts`: cada intencion nueva, ambiguos, faltantes, duplicados, deshacer, confirmacion negada, cifras inventadas o sumadas por el modelo, Omar y consultas.
- Simulador local: `npx tsx scripts/agente/simulador.mts scripts/agente/guion-ejemplo.txt` (sin red ni base).
- `test/unit/agente/agente.ampliado.test.ts`: catalogo declarativo, esquemas, comandos nuevos, confirmacion reforzada, faltantes con botones, firma personal, limite de frecuencia y Omar.
- `supabase/tests/database/032_telegram_agente_verificacion.test.sql` (pgTAP) y `test/unit/agente/agente.verificacion.test.ts`: clasificacion real en tarjeta y resultado, capital propio, lote con candado en SQL, resolver_toma verificado, telefonos, montos ambiguos y privilegios por funcion.
- `supabase/tests/database/031_telegram_agente_endurecimiento.test.sql` (pgTAP) y `test/unit/agente/agente.seguridad.test.ts`: autor verificado, firma con boton propio, hash del efecto, deshacer entre socios, privilegios, reenviados, orden de reclamos, quien confirma, precios, capital y webhook.
- `supabase/tests/database/030_telegram_agente_ampliado.test.sql` (pgTAP): cada tipo de `agente.ejecutar_ext`, simulacion que no deja nada, idempotencia, deshacer, consultas, permisos y RLS.
- `test/integracion/telegram_e2e.test.ts`: extremo a extremo contra la base local con el webhook, Telegram con fetch falso (nunca sale a api.telegram.org) y la IA simulada: dia de operacion completo (compra, recepcion, pedido, envio, cobro, gasto, reembolso) con `cuadra = true` por dos vias, mas un caso por tipo de situacion (faltante, suma que no cuadra, sin permiso, doble envio, confirmacion expirada, miembro no autorizado, secreto invalido).
- `scripts/agente/simular-telegram.mts`: el mismo camino contra una base LOCAL, con guion (`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<puerto>/postgres npx tsx scripts/agente/simular-telegram.mts scripts/agente/guion-telegram.txt`). Se niega a correr si la base no es local.

## «Mi valuación» y «cómo estamos» (14-nov)

Consulta determinista (`consulta: valuacion`): la valuación de quien pregunta, cuánto más o menos tiene que el otro, cuánto falta para estar idénticos y cómo igualar («Para igualar: entrega a la sociedad los $F que tienes cobrados y aporta $A con el siguiente pago»; al que tiene más: «Angelo debe igualar: faltan $X (entregar $F + aportar $A)»). Solo socios. Las cifras vienen de `agente.valuacion_socios()`; el texto lo arma código, no el modelo. Simulador: `npx tsx scripts/agente/simulador.mts scripts/agente/guion-valuacion.txt`.

## Alta asistida (modelos, sabores, clientes): estado

Hecho y verificado: el núcleo de base para SABORES, `catalogo.alta_sabor` (validación del nombre como dato, parecidos por distancia de edición con umbral documentado, idempotencia, topes de 10 por hora y 30 por día por actor, auditoría con origen), usado por el botón «Crear sabor nuevo» de la hoja de conteo web. El canal `telegram` está admitido por la función pero NINGUNA ruta del bot la llama todavía.
Pendiente (no activado): tarjeta con botones en el grupo para sabor, modelo y cliente desconocidos, alta de modelo (marca obligatoria, puffs por omisión) y de cliente (solo nombre y tipo; el teléfono nunca pasa por el modelo), reanudar el pedido que originó la mención, simulador y pgTAP de esos flujos. Ver `docs/alta-asistida-pendiente.md`.

## Dinero entre socios, gastos, renta y valuacion por bot (carril socios y gastos)

Sin topes y sin tarjeta: el bot pregunta lo que falte (que socio, cuanto, a quien, por transferencia o efectivo, la intencion) y registra cuando tiene todo. El modelo de IA no calcula dinero.

- Aportacion o deposito: la INTENCION se pregunta siempre. Reembolso es lo que queda si el socio no declara capital; capital solo si el socio lo declara y lo registra quien lo pone.
- Entrega de fondos: el socio entrega a la sociedad (se deshace 10 minutos) o a Isaac o Karen (no se deshace). Baja los fondos de la sociedad que tiene en su poder; NO es aportacion.
- Liquidacion entre socios, retiro de utilidad y reembolso: se deshacen 10 minutos.
- Retiro de capital: lo propone quien retira y lo confirma el OTRO socio con su propio mensaje (mismo monto). No se deshace.
- Renta de Omar: la paga un socio; un pago mayor a lo que se debe se pregunta como anticipo.
- Gasto: pagado por un socio (un gasto de la empresa y un reembolso) o con la caja de la sociedad. Con foto del ticket: la foto queda como evidencia (solo su huella) ligada al gasto; el monto lo escribe el socio; la misma foto no respalda dos gastos.
- Cargo de servicio con tipo de cambio: pregunta moneda, monto, quien pago y el tipo de cambio.
- Acta de corte: `/cierre` consulta el periodo; `/acta` propone; la firma es el mensaje personal de cada socio (`/firmaracta` o "firmo el acta"), queda registrado en SQL y no hay boton generico.
- Valuacion e igualacion: `/valuacion`, "como estamos" y `/igualar angelo|javier` ("cuanto debe Angelo para igualar") con la misma frase del banner (entregar fondos mas aportar). Despues de cada movimiento entre socios el bot avisa al grupo con los saldos de AMBOS.
