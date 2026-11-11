# Nucleo del agente de Telegram (lane `agente-telegram`)

Rama `lane/agente-telegram`. Todo corre contra puertos con implementaciones en memoria y un LLM simulado: ninguna llamada real, ninguna migracion, ningun servidor.

## Que se construyo

| Capa | Archivos | Contenido |
|---|---|---|
| `src/dominio/agente` (puro) | `intenciones`, `resolutor`, `cifras`, `entrada`, `permisos`, `modelos`, `presupuesto`, `deshacer`, `comandos`, `tipos` | Catalogo de intenciones, resolucion de alias con pregunta ante duda, guardia de cifras, limpieza e inyeccion, permisos por rol, router de modelos (politica 19), presupuesto en micro-USD, contramovimiento, comandos sin IA |
| `src/aplicacion/agente` | `agente` (orquestador), `puertos`, `esquemas` (zod estricto), `prompt`, `resolucion`, `plantillas`, `comunicador` | Flujo completo de un update, preguntas con botones, tomas de Omar, deshacer, eco |
| `src/infra/agente` | `telegram_webhook`, `telegram_api`, `openrouter`, `memoria`, `negocio_simulado`, `llm_simulado`, `updates` | Adaptadores detras de puertos (con `fetch` inyectado) y dobles |
| `src/composicion` | `agente.ts`, `simulador_agente.ts` | Cableado en memoria y simulador |
| `scripts/agente` | `simulador.mts`, `guion-ejemplo.txt` | CLI del simulador local |

## Como se integra

```ts
import { AgenteTelegram } from '@/aplicacion/agente/agente';
const agente = new AgenteTelegram({ almacen, presupuesto, llm, telegram, tokens, catalogo, negocio, reloj: () => new Date() });
// ruta app/api/telegram/webhook (otra ola):
const r = await manejarWebhook({ cabeceraSecreto, secretoEsperado, cuerpo, procesar: (u) => agente.procesarUpdate(u) });
return new Response(null, { status: r.status });
// cron cada 15 min: await agente.caducarTomasVencidas();
```

Puertos que otras olas deben implementar (contratos en `src/aplicacion/agente/puertos.ts`): `AlmacenAgente`, `AlmacenPresupuesto`, `AlmacenTokens`, `CatalogoAgente`, `NegocioAgente` (las funciones SQL de pedido, pago, gasto, aportacion, compra, orden de compra, toma de Omar, consultas y deshacer; el modelo no calcula dinero, las calcula ellas) y los adaptadores `crearEnviadorTelegram`, `crearClienteOpenRouter` (reciben `fetch`, token y llave por parametro; nunca leen el entorno). El esquema de base que esto necesita esta en `agente-telegram-necesita-db.md`.

Simulador local: `npx tsx scripts/agente/simulador.mts scripts/agente/guion-ejemplo.txt` (o sin argumento para interactivo).

## Flujo de un update

1. Secreto del webhook en tiempo constante (401 si falla; todo lo demas responde 200). Cuerpo maximo 1 MB.
2. **Reclamo unico por `update_id`** (antes de gastar IA). Segundo reclamo por `(chat, mensaje)`: un reenvio con otro `update_id` o un mensaje editado ya procesado no se vuelve a ejecutar.
3. Identidad por id de Telegram. Grupo de socios: solo socios. Chat privado de un socio: la respuesta va al grupo. Chat privado de Omar: solo Omar. Grupo no registrado: el bot sale. Ajenos: silencio.
4. Comando (`/pedido`, `/pago`, ...): sin IA, mismo canal de resolucion, ejecucion y eco. Texto libre: prefiltro (sin cifras ni palabras del negocio no gasta nada), modo sin IA si esta activo, y si no: **reserva de presupuesto del peor caso -> modelo -> liquidacion con el costo real** (se libera si falla). Esquema estricto con una reparacion como maximo; resultado guardado por clave (no se paga dos veces).
5. **Guardia de cifras de entrada**: cada pieza, monto o precio que devuelve el modelo debe aparecer en el mensaje (cifras, `1.5k`, `15 mil`, palabras). Si no, no se ejecuta y se pregunta.
6. Permisos por rol, deteccion de inyeccion (marca sospecha: ninguna escritura sale de ese mensaje) y **resolucion de alias en codigo**: unico / varios / ninguno / vacio. "Omar" a secas (de un socio) y "Waka 50" **siempre** preguntan (botones de un solo uso, maximo 3 preguntas seguidas, caducan a 24 h).
7. Ejecucion idempotente (`tg:<update_id>:<n>`): eco con folio, lineas, **comprobacion**, saldo resultante y boton **Deshacer** (10 min, un toque). Con dependencias o fuera de ventana se muestran y se pide indicacion expresa. Deshacer = contramovimiento enlazado, nunca borra.
8. **Guardia de cifras de salida**: todo numero de cualquier mensaje debe haber sido entregado por el servidor (`RegistroCifras`); si no, el mensaje se bloquea y se registra el evento.

Tomas de Omar: cada una queda **pendiente** (reserva activa, sin kardex ni saldo), tarjeta en el grupo con Autorizar/Rechazar (basta un socio; se invalidan entre si; caducan a 72 h), Omar recibe solo "recibido", "autorizado" (con su saldo semanal), "rechazado" o "caduco". Omar no puede pulsar botones de socios (alerta de pantalla, sin cambios, el token no se consume). Todo lo que Omar escribe fuera de tomas y consultas propias: "Eso lo registran los duenos, ya les avise" y aviso al grupo. Lo que va a Omar pasa por lista blanca de plantillas y lista negra de terminos (`costo|margen|utilidad|proveedor|Isaac|Karen|socio|cliente|...`).

Presupuesto: US$1 al dia y US$30 al mes, alerta al 80 % (una vez), reparto por rol (texto 0.55, vision 0.25, audio 0.05, redaccion 0.10, resumen 8 pm 0.05 reservado). Al tope: modo sin IA con aviso unico; los comandos siguen funcionando.

Modelos (politica 19): texto Haiku 5.5 -> GPT-6 Luna -> DeepSeek V4.1 Flash; vision Haiku con segunda lectura Luna (`compararLecturas`: si los montos no coinciden se pregunta a un socio); redaccion Luna -> Haiku; audio Whisper large-v3-turbo. Techo 0.15 / 0.60 USD por millon; Sonnet, Opus, Gemini y Qwen estan prohibidos por codigo (`esProhibido`), y el cliente de OpenRouter rechaza cualquier slug fuera de la tabla **antes** de la red. Cada llamada lleva `zdr: true` y `data_collection: "deny"`; el modelo chino solo corre con una lista blanca de endpoints de EE.UU. inyectada (sin ella se omite).

## Pruebas de aceptacion (todas automatizadas)

| Criterio | Archivo |
|---|---|
| Mismo mensaje dos veces se aplica una sola vez | `test/unit/agente/agente.idempotencia.test.ts` |
| Omar a secas y Waka 50 siempre preguntan | `agente.ambiguedad.test.ts`, `resolutor.test.ts` |
| Toma de Omar pendiente hasta que un socio autoriza | `agente.omar.test.ts` |
| Ningun numero que no venga del servidor llega a una respuesta | `agente.guardias.test.ts`, `cifras.test.ts` |
| Presupuesto reservado antes de cada llamada y corte al tope | `agente.presupuesto.test.ts`, `politica.test.ts` |
| Modo sin IA responde a los comandos | `agente.presupuesto.test.ts` (seccion modo sin IA), `comandos.test.ts` |

Mas: adendas 21 y 23 con cifras doradas (`agente.negocio.test.ts`), adaptadores con `fetch` simulado (`adaptadores.test.ts`), reglas del modulo (`reglas.test.ts`).

## Desviaciones y choques (mandan la spec 14 y las adendas)

1. **Ejecutar con eco y Deshacer, no tarjeta de confirmacion.** El documento 04 propone propuesta + boton Confirmar para toda escritura; la spec 14 sec. 12 y la adenda 23 ("sin segundo si, con eco, comprobacion y deshacer") mandan ejecutar y pedir solo ante duda. Implementado asi; el servidor decide las preguntas (`precio_fuera_tabulador`, `existencia_insuficiente`, `menos_de_20_piezas`, `monto_parecido_a_saldo`...) y el socio contesta "Si, continuar" o cancela.
2. **Ventana de deshacer de 10 minutos** (spec 14 / 26), no 15 (documento 04).
3. **Sin escalamiento a Sonnet** (politica 19): la parte de US$0.15 del reparto diario pasa al rol de texto.
4. **Toma de Omar no es auto-registro**: el 04 la registra sin confirmar; la spec 14 sec. 12 y la 26 la dejan pendiente hasta que un socio autorice. Una toma escrita por un socio tambien queda pendiente.
5. Rol de Omar `omar` (no `bodega`), como en la spec 26.
6. Los botones usan tokens de un solo uso (`AlmacenTokens`, spec 26 sec. 5) en lugar de `c:<id>:<v>`; el estado de la accion en curso viaja en el token, no en el `callback_data`.
7. Las citas del propio mensaje del socio dentro de una pregunta ("En 'Villa 28 waka 50', cual modelo...") se registran como procedencia del usuario; es la unica cifra no calculada por el servidor que puede aparecer y siempre es texto del propio socio.
8. Slugs de modelo de referencia de la politica (`anthropic/claude-haiku-5.5`, `openai/gpt-6-luna`, `deepseek/deepseek-v4.1-flash`): hay que **fijarlos por slug fechado** al correr la prueba de modelos; la lista de endpoints de EE.UU. con retencion cero de DeepSeek se inyecta por configuracion.
9. Costo de Whisper: 30 micro-USD por segundo es un supuesto conservador hasta medir.

## Pendientes reales

- Lectura de fotos (R2 con segunda lectura) y transcripcion de audios (R3): el router, las politicas y `compararLecturas` estan; no hay lector conectado. Hoy fotos y audios quedan "sin leer".
- Cola por chat con arrendamiento, debounce de mensajes cortos y album, `completarUpdate` con lease (hoy el reclamo es atomico pero un fallo despues del reclamo pierde ese mensaje: se avisa al grupo y se registra).
- Limite de 40 llamadas al modelo por hora y por usuario, y circuito abierto tras 3 fallos en 2 minutos.
- `/tope`, `/anular <folio>`, `/explicar` con cadena de movimientos, `/procesar`, "Ver mas" y orden de candidatos por frecuencia de uso.
- Resumen de las 8 pm y avisos (los envia la ola de notificaciones; este modulo solo reserva su presupuesto).
- `migrate_to_chat_id`, guardia horaria de membresia (`getChatMemberCount`), coincidencia difusa de transferencias duplicadas y unicidad `(cuenta_destino, clave_rastreo)`.
- Reintentos y outbox de envio (los hace la ola de entrega y revision; `ErrorTelegram` ya trae `rate_limit` con `retry_after`).
