# Bot de Telegram: frenos de escritura (carril frenos, 16-nov)

Decisiones del dueno (14-nov) que este carril aplica. El bot ya NO muestra tarjeta de confirmacion para dinero: registra cuando tiene todos los datos, pregunta lo que falte y se protege con frenos que viven en SQL.

## Interruptor `agente_escritura` (nace APAGADO = solo lectura)

- `seguridad.interruptor.clave = 'agente_escritura'`, `activo = false` al migrar. El dueno lo enciende despues, desde el grupo, con `/escritura`. `/lectura` lo apaga.
- Un unico punto lee el interruptor en SQL: `agente._exigir_escritura()` (P0463, falla cerrado). Lo llaman `agente.ejecutar`, `agente.ejecutar_ext`, `agente.resolver_toma` y `agente.sabor_responder` (envoltorios creados por rename + wrap sobre la ultima definicion). TypeScript lo lee con `agente.escritura_estado()` para responder "Estoy en solo lectura desde HH:MM".
- Apagado siguen funcionando: consultas y `deshacer` (es una reversa, no un registro nuevo).
- Solo un socio verificado lo cambia (`agente.fijar_escritura` exige el id de Telegram del socio). Cada cambio queda en `agente.escritura_cambio` y se avisa al grupo con quien lo hizo.
- Apagado automatico por anomalia (`agente.revisar_anomalia`, la llama TypeScript tras cada escritura): mas de 80 movimientos del agente en 5 minutos, 10 bloqueos por duplicado en 5 minutos, o 10 errores de escritura en 5 minutos. Solo puede APAGAR; reactivar lo hace un socio con `/escritura`.

## Antiduplicado por huella de contenido

`agente._huella` (tipo, monto, cliente o proveedor, cuenta, quien pago, via, pedido, lineas, motivo...) en una ventana de 10 minutos, incluido el OTRO socio. No rechaza: la base devuelve `posible_duplicado` con el folio previo y los minutos, y el bot pregunta "¿Es otro distinto?" (botones "Si, es otro" / "No, cancelar"). Un reintento con la misma clave de idempotencia nunca es duplicado; un movimiento deshecho deja de contar.

Nota de diseno: la huella NO incluye al autor para atrapar la doble captura entre socios (hallazgo H3 de la auditoria); el autor del movimiento previo se guarda y se muestra.

## Cobro mayor a lo que debe el cliente

Misma regla que P0429 de la web (`pedido_saldo` de los pedidos enviados), SIN su tope absoluto de 10,000,000: el bot no tiene topes. Si el cobro excede lo que debe, la base devuelve `pregunta_exceso` y el bot pregunta si es un anticipo; solo con "Si, es anticipo" se registra (`confirmo_exceso`).

## Eco rico

El resultado de `ejecutar` trae `eco_rico` (cifras de SQL): cliente canonico, cuenta, pedidos aplicados con su monto, saldo del cliente antes y despues, anticipo a favor. TypeScript solo le da formato.

## Deshacer: 10 minutos para todos

`agente._puede_deshacer` ya no da privilegio al autor. Pasados 10 minutos nadie deshace desde Telegram (mensaje claro: corrigelo con un movimiento inverso o desde el software). `"deshaz eso"` y `/deshacer` sin folio toman el ultimo movimiento propio DENTRO de la ventana. El deshacer devuelve el efecto revertido (`revertido`) y el bot lo muestra.

Lista explicita de lo que NO se deshace (`agente.tipos_no_reversibles()`): envio y entrega de pedido, cancelacion de pedido, aprobacion, estado y recepcion de compra, conteo, alta de cliente, precio, propuesta y firma de acta. Se corrigen por contramovimiento.

## Webhook

- `agente.tg_update` tiene estado (`reclamado`, `terminado`, `fallido`, `abandonado`), lease de 120 s, intentos y el cuerpo del update (se borra al terminar). `agente.reclamar_update2` devuelve `nuevo`, `reprocesar` o `duplicado`. Maximo 3 intentos; el abandonado se avisa UNA vez al grupo ("reenvialo").
- La ruta declara `maxDuration = 60`. Responde 200 solo despues de registrar el update; si el registro falla responde 500 y Telegram reintenta con el mismo `update_id`.
- El barrido (`barrerUpdates`, dentro del latido) reprocesa fallidos y con lease vencido. Con `telegram_envio` apagado no hace nada. El latido sigue sin disparador: nada se enciende en produccion.
- `migrate_to_chat_id`: `agente.migrar_chat` actualiza `agente.chat_registrado` y `notificacion.destino` juntos. El bot NO sale de un grupo no registrado si escribe un socio; solo sale de grupos a los que lo agrego alguien que no es socio. `ErrorTelegram('migrar')` lee `parameters.migrate_to_chat_id` de la Bot API para las entregas (`400_migrar`).

## Sin topes ocultos

- Mensajes largos: ya no se recortan a 2,000 caracteres; se parten por lineas (20 lineas o 1,500 caracteres por parte), cada parte va al modelo y al final el bot avisa "Recibi N lineas: registre X, pregunte Y, no entendi Z".
- Sin tope de 6 acciones por mensaje; tokens de salida proporcionales a la parte (`maxTokensSalidaPara`, ya no 700 fijos); esquema sin el maximo de 1,000,000 (solo un techo tecnico de 10^12 centavos).
- Un monto escrito con "k" o "mil" se repite con la cifra completa antes de registrar (`esMontoAbreviado`).

## Punto de integracion para la conversacion

`AgenteTelegram.ejecutarOperacionCompleta(operacion)` recibe una operacion con todos sus datos resueltos y la escribe con todos los frenos. Es lo que debe llamar la maquina de estados de conversacion cuando termina de preguntar.

## Modo de privacidad del bot (BotFather)

Con el modo de privacidad ACTIVADO el bot solo recibe en grupos los comandos (`/...`) y las respuestas directas a sus mensajes: el texto libre del grupo no le llega. Para verificarlo sin tocar nada:

1. `getMe` devuelve `can_read_all_group_messages`. Debe ser `true`.
2. Si es `false`, en BotFather: `/mybots` > el bot > Bot Settings > Group Privacy > Turn off. Despues hay que sacar y volver a agregar el bot al grupo para que el cambio aplique.
3. `getWebhookInfo` muestra `url`, `pending_update_count`, `last_error_message` y `allowed_updates` (deben incluir `message`, `edited_message` y `callback_query`).

Esto NO se pudo verificar en este carril (no hay token ni se envia nada real).
