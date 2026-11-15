# Interprete del bot de Telegram (carril interprete, 14-nov-2026)

Decisiones del dueno que gobiernan este carril: sin topes ni tarjeta de confirmacion; el modelo solo extrae y marca lo que falta; el servidor pregunta hasta cerrar la operacion y solo entonces escribe.

## Que hace el interprete

1. Lee el mensaje de un socio y devuelve JSON del esquema estricto (zod `strictObject`, una propiedad desconocida = rechazo): intenciones, textos copiados tal como se dijeron y cifras tal como aparecen.
2. Nunca calcula dinero, ni resuelve ids, ni escribe fechas o dias, ni pone `pregunta_id`: eso lo hacen SQL, el codigo y la memoria del servidor.
3. La guardia de cifras (`src/dominio/agente/cifras.ts` y `guardia_ampliada.ts`) liga cada cifra a su clase y escala antes de ejecutar nada.

## Intenciones (51 variantes)

Las 31 originales mas 20 ampliadas (`src/dominio/agente/intenciones_ampliadas.ts`, esquemas en `src/aplicacion/agente/esquemas_ampliados.ts`, filas del catalogo en `catalogo_ampliado.ts`):
`pedido_ds`, `envio_lote`, `guias_lote`, `plazo_acordar`, `recargo_credito`, `compra_cierre`, `entrega_fondos`, `liquidacion_socios`, `retiro_capital`, `renta_omar`, `obsequio`, `sabor_alta`, `modelo_alta`, `costo_lista`, `alias_ensenar`, `alias_respuesta`, `sabor_respuesta`, `slot_respuesta`, `correccion`, `cancelar`; y las consultas `por_cobrar`, `vencimientos`, `que_se_vende`.

Estado `extraido` en el catalogo: el interprete ya las extrae y valida, pero la puerta de ejecucion (`agente.ejecutar_ext` con su `tipoHub` y las funciones SQL citadas) la construye otro carril. Mientras tanto el agente responde "entendi, todavia no esta conectada" y no registra nada. Al conectar una puerta, su fila pasa a `activa`.

## Guardia de cifras

* Piezas: no se explican con dinero (`$500`, `500 pesos`, `a 250 c/u`), folios, guias, fechas (`20 de noviembre`, `2026-11-12`), horas ni plazos (`a 15 dias`).
* Dinero: no se explica con piezas rotuladas, folios, guias, fechas ni plazos. `20k` vale 20,000 y nunca 20. Se liga a UNA mencion: dos campos con el mismo monto exigen que el mensaje lo diga dos veces (salvo "cada uno").
* Folios (`pedido_folio`, `compra_folio`, `folios[]`...): deben estar escritos en el mensaje (P-12 = P-0012).
* Textos libres: ningun numero que el mensaje no traiga.
* Un monto escrito con `k`, `mil`, con letra o de forma aproximada se REPITE completo y se pregunta antes de registrar (`montosQueSeRepiten`).

## Sin topes ocultos

Se quitaron: recorte a 2,000 caracteres (`sanitizar` ya no recorta; el limite es el de Telegram), 6 acciones (ahora 50, solo limite tecnico), 700 tokens de salida (ahora proporcional al mensaje: `maxTokensSalidaPara`), monto maximo de 1,000,000 y piezas maximas de 2,000 (ahora solo el limite tecnico de cordura de 10^13 centavos y 1,000,000 de piezas), y la frase "maximo 6" del prompt. Para mensajes que no quepan, `bloques_mensaje.ts` divide por lineas y arma el aviso "Recibi N lineas: registre N, pregunte M, no entendi K" (el cableado a `agente.ts` queda para el carril de flujo).

## Modelos, presupuesto y degradacion

Cadena de texto: Haiku 5.5 (`json_object`, zod estricto y un reintento con los errores), GPT-6 Luna (`json_schema`), DeepSeek v4.1 flash solo con proveedores de EE.UU. (lista blanca; sin ella no se intenta). Sonnet, Opus, Gemini, Qwen y GPT-6 grande estan prohibidos en codigo. Se reserva el peor caso antes de cada llamada (incluido el esquema y los tokens de salida del mensaje), se liquida con el costo real que reporta el proveedor y los intentos fallidos facturados tambien se liquidan. Si todos los proveedores caen o se agota el presupuesto: modo sin IA (solo comandos). El modo sin IA por tope de presupuesto ya no es permanente: la siguiente reserva decide.

## Evaluacion contra el modelo real

`npx tsx scripts/agente/prueba-modelo.mjs --salida <carpeta fuera del repo> --proveedores haiku --tope 0.60`. Lee la llave de `~/.bodega-secrets/openrouter.key` (nunca se imprime). El banco vive en `scripts/agente/banco/` (nombres y cifras ficticios; los casos con `pendiente` simulan la pregunta pendiente del bot y los de `fuente: "reenviado"` un mensaje reenviado).

## Resultado de la evaluacion real del 14-nov (Haiku 5.5, OpenRouter)

Gasto real acumulado de la evaluacion: US$0.59 de un tope de US$0.60 (mas US$0.012 de una prueba de humo de 6 llamadas). Banco: 158 frases nuevas o reetiquetadas.

* Primera corrida completa (prompt r6.1, 157 frases): intencion 94.3 %, 0 cifras de dinero inventadas, 98.7 % de zod valido (6 reintentos).
* Tras iterar el prompt (r6.2 a r6.4) sobre los casos que fallaron y sobre las categorias afectadas: intencion 157 de 158 (99.4 %) tomando la ultima corrida de cada frase, campos 130 de 130. El prompt final (r6.4) corrio completo solo en 12 frases, r6.3 en 29 y r6.2 en 86: no hay una sola corrida del banco entero con el prompt final (el tope de gasto no alcanzaba).
* Una cifra inventada en todas las corridas (monto 1 en "retiro de capital" sin monto, r6.3): la guardia la bloquea; con r6.4 el mismo mensaje da "aclarar".
* Luna con salida estructurada estricta rechazaba el esquema entero con 400 (un `.optional()` de zod dejaba plazo_texto fuera de `required`); corregido en `adaptarEsquemaParaProveedor` y verificado con una llamada real (200, zod valido).
