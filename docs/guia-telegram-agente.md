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
| Saldo de un cliente o proveedor | "saldo de Cliente Norte", "saldo con Karen" | `/saldo Cliente Norte` |
| Existencias por modelo | "cuanto hay de jupiter" | `/stock jupiter` |

La utilidad es una aproximacion operativa; la cifra contable esta en el software (Contabilidad).

### Segunda entrega: casi todo lo util del sistema desde el chat

Cada fila es una intencion del catalogo declarativo (`src/dominio/agente/catalogo_intenciones.ts`: intencion, puerta SQL, nivel de confirmacion, quien puede, si tiene reversa). La IA solo clasifica y extrae campos (esquema zod estricto por intencion); jamas genera SQL ni calcula dinero. Antes de pedir confirmacion, el servidor SIMULA la operacion (`agente.simular`, se revierte siempre) y el resumen muestra su efecto real: precios del tabulador, importes, saldos y el cuadre por dos vias. Si la base no aceptaria la operacion, se rechaza en ese momento, antes de escribir.

| Que haces | Mensaje o comando | Confirmacion | Deshacer |
|---|---|---|---|
| Crear pedido (precio del tabulador, lo pone el sistema) | `/pedido Cliente \| modelo/sabor 24` o "Cliente: 24 modelo/sabor" | normal | si, mientras no este enviado (se cancela) |
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

### Lo que NO hace

- Nunca escribe a clientes ni a terceros: todo va al grupo de los dos socios. No envia correos ni reportes por correo.
- La IA no ve telefonos ni correos (se ocultan antes del prompt) y nunca calcula dinero.
- Omar no registra nada por esta via (solo toma piezas y consulta lo suyo); no ve costos ni contactos.
- Fotos y audios: se avisa que se recibieron pero no se leen (no hay ruta de transcripcion de notas de voz en esta rama); el socio escribe el dato.
- Devoluciones y paquete perdido: contrato listo, no se registran hasta integrar sus ramas.
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

## Como se probo

- `test/unit/agente/agente.socios.test.ts`: cada intencion nueva, ambiguos, faltantes, duplicados, deshacer, confirmacion negada, cifras inventadas o sumadas por el modelo, Omar y consultas.
- Simulador local: `npx tsx scripts/agente/simulador.mts scripts/agente/guion-ejemplo.txt` (sin red ni base).
- `test/unit/agente/agente.ampliado.test.ts`: catalogo declarativo, esquemas, comandos nuevos, confirmacion reforzada, faltantes con botones, firma personal, limite de frecuencia y Omar.
- `supabase/tests/database/031_telegram_agente_endurecimiento.test.sql` (pgTAP) y `test/unit/agente/agente.seguridad.test.ts`: autor verificado, firma con boton propio, hash del efecto, deshacer entre socios, privilegios, reenviados, orden de reclamos, quien confirma, precios, capital y webhook.
- `supabase/tests/database/030_telegram_agente_ampliado.test.sql` (pgTAP): cada tipo de `agente.ejecutar_ext`, simulacion que no deja nada, idempotencia, deshacer, consultas, permisos y RLS.
- `test/integracion/telegram_e2e.test.ts`: extremo a extremo contra la base local con el webhook, Telegram con fetch falso (nunca sale a api.telegram.org) y la IA simulada: dia de operacion completo (compra, recepcion, pedido, envio, cobro, gasto, reembolso) con `cuadra = true` por dos vias, mas un caso por tipo de situacion (faltante, suma que no cuadra, sin permiso, doble envio, confirmacion expirada, miembro no autorizado, secreto invalido).
- `scripts/agente/simular-telegram.mts`: el mismo camino contra una base LOCAL, con guion (`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:<puerto>/postgres npx tsx scripts/agente/simular-telegram.mts scripts/agente/guion-telegram.txt`). Se niega a correr si la base no es local.
