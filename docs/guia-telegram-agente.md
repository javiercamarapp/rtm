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

### Lo que NO se registra por Telegram

- Apertura y saldos historicos, y cualquier fecha pasada: se capturan en la sesion de apertura del software (con revision y firma). El agente contesta que se hace ahi.
- Reinversion de utilidades: la decide el corte mensual con acta firmada, no un mensaje.
- Fotos y audios: el agente avisa que los recibio pero no los lee; escribe el dato.
- Pedidos, compras y ordenes de compra: la base de esta rama todavia no los acepta desde Telegram (se hacen en el software).

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
- La migracion de esta rama es `20261113100000_telegram_agente_socios.sql` (aditiva; posterior a 20261113000400).

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

## Como se probo

- `test/unit/agente/agente.socios.test.ts`: cada intencion nueva, ambiguos, faltantes, duplicados, deshacer, confirmacion negada, cifras inventadas o sumadas por el modelo, Omar y consultas.
- Simulador local: `npx tsx scripts/agente/simulador.mts scripts/agente/guion-ejemplo.txt` (sin red).
