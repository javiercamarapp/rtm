# Bot de Telegram de RTM: como operarlo

Para Javier y Angelo. Estado de origen: el bot esta construido, probado y **apagado** (solo lectura). Nada se escribe ni se envia hasta que un socio encienda los interruptores, en el orden de este documento. Para publicar el codigo y las migraciones, ver `docs/bot-telegram-runbook-despliegue.md`. El detalle de cada carril esta en `docs/guia-telegram-agente.md`, `docs/telegram-frenos.md`, `docs/cobranza-telegram.md`, `docs/reloj-base-datos.md`, `docs/avisos-inventario-proveedores.md` y `docs/avisos-unificados.md`.

## Que hace el bot

Solo habla con los dos socios (grupo de socios) y con Omar en privado. Mensajes reenviados y archivos se tratan como datos no confiables: sus /comandos se ignoran y nada reenviado registra dinero. El modelo de IA interpreta lo que escribes, pero **nunca calcula dinero**: todas las cifras que ves vienen de la base de datos.

Operaciones que registra (pregunta lo que falte; no usa tarjeta de confirmacion):

| Grupo | Operaciones |
|---|---|
| Cobros | cobro de cliente (cuenta destino, pedido al que se aplica), pago redirigido a Isaac o Karen |
| Pedidos | bodega, dropshipping, a costo del socio de menudeo; enviado, entregado, cancelado; envio y guias en lote |
| Compras | compra, orden de compra, en trayecto, recepcion total o parcial, cierre con faltante |
| Dinero entre socios | aportacion (reembolso o capital), entrega de fondos, liquidacion entre socios, reembolso, retiro de utilidad, retiro de capital (lo confirma el otro socio), renta de Omar, gasto (con o sin foto de ticket), servicio con tipo de cambio, acta de corte |
| Catalogo | alta asistida de cliente, sabor y modelo; alias y jerga que el bot aprende (con revision semanal) |
| Postventa | devolucion de cliente, paquete perdido o danado |
| Consultas | saldos, cartera, cuentas, valuacion, `/igualar`, vencimientos, pedidos de un cliente, `/vende`, `/reponer` |

## Como hablarle

- Escribe natural: "cobre 15 mil de Pablo en efectivo", "pedido para Pablo: 24 mango y 12 uva". Si falta un dato, pregunta (cliente, modelo y sabor, cantidad, cuenta, quien pago, plazo del credito, via).
- Montos: "15 mil" o "15k" se repite con la cifra completa antes de registrar. Un monto ambiguo (por ejemplo `1.250`) se pregunta.
- Lotes: varios renglones en un mensaje se procesan por partes; al final avisa "Recibi N lineas: registre X, pregunte Y, no entendi Z". Reglas del lote (varias operaciones que escriben):
  - Si una operacion no se resuelve en el catalogo (cliente, modelo, sabor desconocido o ambiguo) o el modelo pide una aclaracion, el bot **pausa el lote completo antes de escribir**: no registra ninguna y lo dice ("Pause el lote completo ... nada quedo registrado"). Se reenvia completo y corregido; no se duplica nada.
  - Si una pregunta de la conversacion (cuenta, plazo, forma de pago...) aparece a media ejecucion, las operaciones **siguientes se pausan** y el aviso final dice cuantas y desde cual; las anteriores ya quedaron registradas y se ven en sus ecos. Nunca se pierde una linea en silencio.
  - Renglones iguales (por ejemplo tres gastos de 150): se registra el primero y el bot hace **una sola pregunta** para los demas ("¿Son movimientos distintos y los registro?"), no una por renglon.
- Folios: pedidos por iniciales del cliente y consecutivo de tres digitos (por ejemplo `ML-001`); cobros `PG-`, gastos `G-`, tomas de Omar `T-`; los hechos del bot llevan su propio folio que se ve en el eco.
- Eco: cada registro responde con cliente, cuenta, pedidos a los que se aplico, saldo antes y despues y lo que queda a favor. **Revisa ese eco**: si el pedido o el monto no son los que querias, deshaz de inmediato.

## Preguntas que hace el bot

| Pregunta | Cuando | Botones | Caduca |
|---|---|---|---|
| Faltante de datos | falta cliente, sabor, cuenta, plazo, pedido, etc. | opciones o respuesta libre | 24 h |
| ¿A que pedido lo aplico? | el cliente tiene mas de un pedido abierto | un boton por folio | 24 h |
| Posible duplicado | mismo movimiento (tipo, monto, contraparte, cuenta, pedido, lineas) en 10 minutos, incluso del otro socio | Si, es otro / No, cancelar | **10 min** |
| Cobro mayor a lo que debe | el cobro excede el saldo de pedidos enviados del cliente | Si, es anticipo / No, cancelar | **10 min** |
| Confirmar capital | un retiro de capital lo propone quien retira y lo confirma el otro socio con su propio mensaje | mensaje del otro socio | **10 min** (pasado, quien retira lo propone de nuevo) |

El cobro que elegiste para un pedido se aplica **primero a ese pedido**; si sobra, sigue la regla de siempre (el pedido enviado mas antiguo) y el resto queda a favor del cliente.

## Comandos principales

Escribirlos en el grupo de socios. Lista completa: `/ayuda`.

- `/lectura` apaga toda escritura del bot (solo consultas y deshacer). `/escritura` la enciende. Solo un socio verificado; cada cambio queda registrado y se avisa al grupo con quien lo hizo.
- `/deshacer [folio]` revierte el ultimo movimiento propio o el folio indicado. **Solo dentro de los primeros 10 minutos, para los dos socios.** Despues se corrige con un movimiento inverso o desde el software.
- No se deshacen por Telegram: envio y entrega de pedido, cancelacion de pedido, aprobacion, estado y recepcion de compra, cierre de compra, conteo, alta de cliente, precio, propuesta y firma de acta, retiro de capital, entrega a proveedor, devolucion y paquete perdido. Se corrigen con un contramovimiento.
- Consultas y atajos: `/estado`, `/resumen [hoy|ayer|semana]`, `/pendientes`, `/cartera`, `/cuadra`, `/valuacion`, `/igualar angelo|javier`, `/vende`, `/reponer`, `/minimo [modelo sabor piezas]`, `/avisos` (con `encender|apagar` y `regla CODIGO encender|apagar` para los avisos de inventario).
- Operaciones por comando: `/pedido`, `/pago`, `/pagoprov`, `/gasto`, `/aporte`, `/reembolso`, `/retiro`, `/devolucion`, `/paquete`, `/compra`, `/enviado`, `/entregado`, `/cancelar`, `/acta`, `/firmaracta`, entre otros.

## Frenos que protegen el dinero (viven en SQL)

1. **Interruptor `agente_escritura`**: apagado, ninguna escritura entra (error P0463, falla cerrado). Se apaga solo por anomalia (mas de 80 movimientos en 5 minutos, 10 bloqueos por duplicado contra folios **distintos** en 5 minutos o 10 errores de escritura); reactivar es decision de un socio con `/escritura`.
2. **Antiduplicado** con candado por cliente y por huella: dos socios capturando lo mismo al mismo tiempo no se cruzan.
3. **Sobrepago**: pregunta, nunca topa.
4. **Cobro sin cliente**: se rechaza (P0460); el bot siempre pregunta de que cliente es.
5. **Deshacer 10 minutos** para todos.
6. **Presupuesto del modelo**: el uso de IA tiene techo diario, mensual y por rol (`agente.reservar`).
7. **Privacidad**: el modelo no recibe telefonos, correos, domicilios (calle y numero, colonia, codigo postal) ni usuarios de Telegram; ademas va con retencion cero.

## Texto pegado con instrucciones (inyeccion)

Sin tarjetas ni topes de monto. La defensa es estructural (`src/dominio/agente/inyeccion.ts`):

1. El texto llega al modelo siempre dentro de `<mensaje autor=".." fuente="..">` como dato; los `<` y `>` se neutralizan. Las **oraciones** que parecen instrucciones (ignora/olvida, system/rol, herramientas o funciones, SQL, shell, JSON del esquema, bloques de codigo, modo desarrollador) se **omiten** y los enlaces se ocultan; el modelo solo ve `[texto sospechoso omitido]`.
2. El modelo solo puede devolver el esquema cerrado (zod estricto y `json_schema`); cualquier campo fuera de esquema se rechaza. Puede reportar `texto_sospechoso`.
3. Si el servidor detecta esos patrones, o el modelo reporta `texto_sospechoso` o `sospecha_inyeccion`, el bot **no escribe** y pregunta ("mezcla datos de una operacion con texto que parece una instruccion... Escribe solo los datos"). Las consultas de solo lectura siguen funcionando.
4. Quien opera sale de la identidad de Telegram, nunca del texto ("soy Angelo" no cambia nada); el cliente sale del catalogo (un nombre desconocido se pregunta); las cifras de dinero las calcula SQL y se comparan con las del socio (guardia de cifras).
5. Prueba: `npx vitest run test/unit/agente/inyeccion.adversarial.test.ts` (22 ataques tipicos con un modelo obediente) y el simulador `npx tsx scripts/agente/simular-ataques.mts`.

Un enlace solo no bloquea la escritura (se oculta); un patron de instruccion si. Un mensaje legitimo bloqueado por error se reescribe sin esa frase o se usa el comando.

## Interruptores y orden recomendado de encendido

Regla general: **un interruptor a la vez, observar, y solo despues el siguiente**. Cada paso lo autoriza Javier. Todos nacen apagados en `seguridad.interruptor` (las reglas, ademas, en `notificacion.regla` y `agente.aviso_regla`).

0. Requisitos previos (una sola vez, ver runbook): migraciones aplicadas, miembros y chats registrados, webhook con secreto, `telegram_envio` **apagado** y cola historica vaciada.
1. **Escritura de pruebas en un grupo de prueba.** Registrar un grupo de prueba como `grupo_socios` (no el real), con clientes y pedidos de prueba. `/escritura` y recorrer: un cobro con pedido elegido, un cobro mayor a lo que debe (pregunta), un duplicado (pregunta), `/deshacer`, un gasto, un pedido con envio. Verificar el eco contra la web. No pasar al paso 2 si una cifra no coincide.
2. **Escritura real.** Apuntar el chat registrado al grupo real de socios y `/escritura` ahi. Vigilar el primer dia: revisar cada eco y `/cuadra` al cerrar.
3. **Resumen diario.** Reloj (`reloj.encender()`, observar 3 latidos), despues `reloj_http`, despues la regla `resumen_diario` (y `pendientes_diarios`), y por ultimo el maestro `reglas_automaticas`. Una regla solo avisa hechos posteriores a su activacion.
4. **Cobranza.** `cobranza_activa`. Antes, la simulacion del calendario esta en `cb_001`. Solo escribe al grupo de socios; hace ceder las reglas `cobranza_vence_manana` y `cuenta_vencida` del reloj.
5. **Avisos de inventario.** `avisos_inventario` y despues cada regla con `/avisos regla CODIGO encender`. **Antes de encender cada regla** ejecutar la carga silenciosa (`agente.avisos_inventario_evaluar(null, 'silencioso')`) para que lo ya vigente entre como historico y no llegue como alarma.
6. **Lectura de Karen** (`lectura_proveedores`). Lee el sitio de Karen para disponibilidad; la direccion vive solo en una variable privada. Es la ultima porque depende de una fuente externa.

Interruptores que NO se tocan en este orden: `correo_envio`, `promociones_lectura`, `omar_existencia_insuficiente`, `telegram_adjuntar_pdf`, `agente_conversacion_reloj`.

## Como apagar todo

De menos a mas drastico; cada paso es independiente:

1. En el grupo: `/lectura` (el bot sigue contestando consultas, no escribe).
2. Cortar todo mensaje programado: `update seguridad.interruptor set activo = false where clave = 'reglas_automaticas';`
3. Apagar el reloj: `select reloj.apagar();` (apaga `reloj_activo`, `reloj_http` y desactiva los jobs).
4. Apagar cobranza y avisos: `update seguridad.interruptor set activo = false where clave in ('cobranza_activa', 'avisos_inventario');`
5. Cortar toda salida a Telegram: `update seguridad.interruptor set activo = false where clave = 'telegram_envio';`
6. Cortar la entrada: borrar el webhook con `deleteWebhook` de la Bot API (con el token en una variable del shell), o rotar `TELEGRAM_WEBHOOK_SECRET`: sin secreto valido el webhook rechaza todo.

Si se registro algo mal: `/deshacer` dentro de 10 minutos; despues, corregir desde el software o con un movimiento inverso. No se borra ni se edita ningun hecho.

## Limites conocidos (pendientes reales)

- Las preguntas de cobro, duplicado y la confirmacion del retiro de capital caducan en 10 minutos; las demas, en 24 h.
- El pago a un proveedor hecho por un socio con dinero propio NO se deshace por Telegram. Decision: el eco ya no ofrece el boton Deshacer y dice "Este pago NO se deshace por Telegram"; se corrige desde el software o con un movimiento inverso. (Alternativa descartada: volverlo reversible exige tocar la reversa contable de `pago_proveedor_de_socio`; quitar el boton es lo mas seguro.) El pago de la sociedad y el de un cliente directo al proveedor si conservan Deshacer.
- Un lote pausado a media ejecucion (pregunta de conversacion) deja registradas las operaciones anteriores; el aviso dice cuales siguen pendientes. Solo el catalogo y las aclaraciones del modelo se detectan antes de escribir; los datos que pide la conversacion tienen valores por omision propios y no se adivinan.
- Texto pegado con instrucciones: ver la seccion siguiente. Mientras la escritura real no haya pasado una semana, conviene revisar cada eco.
- El destinatario de un pedido de dropshipping no se captura por Telegram: se captura en la web.
