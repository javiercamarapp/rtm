# Unificación de sabores y detección de duplicados

Decisión del dueño (14-nov): unificar "Kiwi Dragonfruit" con "Kiwi Dragon Fruit" y "Passionfruit" con "Passion Fruit" (tienen ventas en ambos nombres; existencia 0 hoy), y que el agente pueda detectar nombres que son lo mismo, entender y relacionar, **preguntar** cuando no esté seguro y, una vez contestado, unificar.

## Regla central

El sistema **nunca unifica solo**. Toda coincidencia termina en una pregunta a un socio. Las únicas excepciones son los dos pares aprobados por el dueño, que se aprueban **por clave explícita** (tabla `catalogo.unificacion_aprobada`, sembrada en la migración) y no por una regla. Un par contestado "no, son distintos" se guarda como **negativo** y no se vuelve a preguntar. El modelo de IA nunca decide: solo extrae si el socio dijo sí o no; la detección y la acción son SQL y código.

## 1. Detección (sin extensiones)

`pg_trgm`, `fuzzystrmatch` y `unaccent` no están instaladas. La detección vive en dos lugares con el mismo resultado exacto (probado par por par):

- TypeScript: `src/dominio/catalogo/duplicados.ts` (`compararNombres`, `candidatosDuplicado`, `decisionAlta`).
- SQL: `catalogo.comparar_nombres(tipo, a, b)` y `catalogo.candidatos_duplicado(tipo, nombre, excluir_id, minimo)`, con `catalogo.dup_*` como piezas puras y `catalogo.diccionario_sabor` como diccionario.

Normalización: minúsculas, sin acentos ni signos, espacios y guiones, plural simple (`berries` = `berry`, `-s`). Distancia de edición (Levenshtein) propia.

| Clase | Puntaje | Qué significa | Ejemplo real |
|---|---|---|---|
| IGUAL_NORMALIZADO | 100 | Mismas letras tras normalizar (con o sin espacio, plural, acentos) | Kiwi Dragonfruit / Kiwi Dragon Fruit; Passionfruit / Passion Fruit |
| MUY_PROBABLE | 80 a 99 | Mismas palabras en otro orden (92), una letra de diferencia (85), abreviatura o traducción conocida (90) | Strawberry Grape / Grape Strawberry; Blueberry Spash / Blueberry Splash; Grape Straw / Grape Strawberry |
| POSIBLE | 50 a 79 | Un nombre empieza como el otro (55 o 65), dos letras de diferencia (68), equivalencia **ambigua** (58 a 62), sigla (50) | Lychee / Lychee Burst; Peach Blue / Peach Blueberry; Peach Blue Razz / Peach Blue Raspberry (razz ambiguo) |
| DISTINTO | menos de 50 | Sin parecido | Cool Mint / Fresh Mint |

El diccionario (`straw` = `strawberry`, `sandia` = `watermelon`, `maracuya` = `passion fruit`, etc.) solo llega a MUY_PROBABLE. Las equivalencias no seguras (`razz`, `icy`, `coco`, `arandano`, `mora`, `lemonade`) solo llegan a POSIBLE y se marcan `ambiguo`: nunca se asumen. "BP" se detecta como posible sigla. Los dígitos nunca se tratan como error de dedo ("Mint 2" y "Mint 3" son distintos).

El motor es genérico: `modelo` y `cliente` usan la misma comparación sin el diccionario de sabores. Solo **detecta y pregunta**.

Límite conocido: "Mixed Berrie Ice" y "Mixed Berries" no se relacionan (distancia mayor a 2 tras quitar espacios); se revisa a mano.

## 2. Cola de preguntas

`catalogo.posible_duplicado (tipo sabor|modelo|cliente, id_a < id_b, motivo, puntaje, clase, ambiguo, estado, preguntado_at, respondido_por, respondido_at, canal, canonico_id, unificacion_id)`.

Estados: `pendiente`, `unido` (sabores unificados), `distinto` (negativo) y `confirmado_igual` (un socio dijo que sí es lo mismo en un modelo o cliente; la unión de esos tipos NO se ejecuta, fase posterior).

Funciones: `api.duplicados_escanear(tipo)` (llena la cola con los pares POSIBLE o más, idempotente), `api.duplicados_pendientes(tipo)`, `api.duplicado_responder(clave, id, 'si'|'no', canonico_id, nombre_final)`, todas con `seguridad.exigir_rol(['socio'])`, idempotentes y auditadas.

## 3. Unificación de sabores (lógica, reversible)

Catorce tablas apuntan a `catalogo.sku(id)` (kardex, existencias, conteos, compras, pedidos, surtidos, reservas, apertura, devoluciones, paquetes) y casi todas son de solo inserción con hash encadenado o con triggers de inmutabilidad. **Ninguna fila de esas tablas se modifica.** Solo cambia el catálogo (mutable):

- Modelo **sin** sku del sabor canónico: el sku del sabor origen se **reasigna** al canónico (mismo `sku_id`; el historial queda intacto y ahora muestra el nombre canónico).
- Modelo que **ya tiene ambos** sabores (caso real: Waka Blade): el sku origen se **fusiona lógicamente**: queda inactivo y marcado `sku.unificado_en` = sku canónico. Sus filas históricas siguen apuntando a él.
- El sabor origen queda `unificado_en` = canónico, conserva el nombre canónico como texto (toda lectura por nombre ya ve un solo sabor), su nombre viejo pasa a alias (`catalogo.sabor_alias`) y a `sabor.nombre_original`, y su llave única de nombre se libera.
- Las altas, pedidos y compras nuevas resuelven al sku canónico: el nombre viejo ya no abre un sabor duplicado (`catalogo.asegurar_sabor` y `catalogo.alta_sabor` resuelven por alias); los listados del agente y la hoja de conteo no ofrecen el sku fusionado.
- **Se bloquea sin escribir** si el sku origen tiene existencia, reserva activa, pedido en borrador o confirmado, compra abierta, toma pendiente, o hay un conteo abierto. Devuelve los motivos.
- Reversible: `api.sabor_unificacion_deshacer` devuelve los sku, restaura nombres y alias, y la pregunta vuelve a quedar pendiente. Se rechaza si otro sabor ya ocupa el nombre original.
- Funciones: `catalogo.unificar_sabor` (idempotente por clave; exige una pregunta pendiente de ese par o una aprobación explícita por clave), `catalogo.deshacer_unificacion_sabor`, `catalogo.unificacion_plan` (solo lectura), `catalogo.huella_inmutables`.
- Canónico por omisión: el sabor con más sku vigentes. **En empate de sku** (`catalogo.sabor_canonico_preferido`, lo usan `canonico_sugerido` de la web y la respuesta por omisión): gana el nombre con **más palabras separadas por espacio** ("Passion Fruit" gana a "Passionfruit"; "Kiwi Dragon Fruit" a "Kiwi Dragonfruit"), luego el **más largo**, luego el de id menor. Así, aunque un socio conteste "sí" antes de que corra el script de aprobados, queda el nombre con espacios. El socio puede elegir el otro y escribir un nombre final.
- **Clave ya deshecha**: si una clave de idempotencia ya tiene el resultado `unificado` pero esa unificación se **deshizo** después, `unificar_sabor` y `responder_duplicado` se detienen con `P0463` ("ya deshecho: usa una clave nueva") en lugar de devolver el resultado viejo sin unificar nada. Para los dos pares aprobados, el script lo detecta antes: `--verificar` avisa "ya deshecho" y `--aplicar` se detiene; con `--aplicar --reaplicar` usa una clave derivada (`clave:r1`, `clave:r2`...) y vuelve a unificar (la aprobación por clave explícita sigue siendo la misma).

Limitación: una devolución de cliente de un renglón vendido con el sku origen reingresa la pieza a ese sku (el kardex es inmutable y el surtido apunta a él). Los totales por modelo no cambian. **Las lecturas por sabor no pierden esas piezas**: se suman al sku canónico (ver "Lecturas por sabor"). Para poder venderlas se traspasa con un movimiento normal al sku canónico.

### Lecturas por sabor (parche 20261115500000, hallazgo H2)

Una lectura que muestra o agrupa por sku trata al sku fusionado (`sku.unificado_en`) como parte de su sku vigente (`catalogo.sku_vigente`, `catalogo.skus_del_grupo`): sus piezas, entradas y salidas se **suman** al canónico y el sku fusionado ya no sale como segundo renglón con el mismo nombre y 0 piezas. Un renglón fusionado solo desaparece de la lista si suma 0; si tuviera piezas, se ven en el canónico. Cubre: `api.inventario_existencia`, `api.inventario_detalle`, `api.inventario_kardex` y `api.inventario_kardex_consolidado` (el filtro por sabor incluye los movimientos del fusionado y su cuadre inicial + entradas - salidas = final se mantiene; pedir el sku fusionado por una liga vieja devuelve el canónico), `operacion.cobertura`, `operacion.inventario_base` (pantalla Inventario), `proveedores.tablero_karen` (ventas y existencia por variante, resolviendo también un `sabor_canonico_id` que apunte al sabor origen) y `proveedores.existencia_propia`. Las pantallas de documentos (pedido, compra, conteo, devolución) muestran el sku histórico por su nombre, que es el mismo texto canónico; los catálogos para elegir sku (`pedido_catalogo`, `compra_catalogo`, `ds_catalogo`, apertura, conteo, agente) ya excluían el inactivo, y `devolucion_proveedor_catalogo` lo excluye ahora. Los totales, el kardex y las comprobaciones C1..C24 no cambian (prueba `a12_003`).

**Cadenas A -> B -> C** (migración `20261115510000`): al fusionar un sku que ya era destino de otros, esos sku se reapuntan al nuevo destino (y los sabores con `unificado_en` igual), de modo que siempre hay un solo salto. Se guarda para la reversa, que exige deshacer en orden inverso (deshacer A -> B mientras B ya está en C se rechaza).

### Redirección de escrituras (hallazgo H4)

- `operacion.resolver_sku` (lo usan crear pedido, crear compra, toma de Omar y devolución a proveedor): un `sku_id` fusionado se **redirige** al sku vigente y el resultado trae `redirigido_de`; por nombre resuelve por nombre propio **o por alias de unificación** (`catalogo.sabor_por_nombre`: "Passionfruit" resuelve a "Passion Fruit"; los alias que no vienen de una unificación no se asumen).
- `registrar_movimiento`, `cerrar_conteo` y las recepciones resuelven el sabor por esa misma regla; la recepción (completa y parcial), el surtido al enviar un pedido y `conteo_diferencias` redirigen un `sku_id` fusionado al vigente.
- **Auditado**: la redirección de un `sku_id` en recepción y surtido deja `REDIRECCION_SKU_FUSIONADO` y la de un nombre-alias en `registrar_movimiento` deja `REDIRECCION_ALIAS_SABOR` (`seguridad.auditoria`). `resolver_sku` es de solo lectura: devuelve `redirigido_de` y no escribe.
- No se redirige la **devolución de cliente**: su renglón apunta al sku que se surtió (kardex inmutable), así que respeta el sku histórico (limitación de arriba).

### Prueba (pgTAP `a12_001`)

Antes y después de unificar son **idénticos** (md5 del contenido completo): kardex, existencias por sku y por modelo, renglones y surtidos de pedido, eventos, asientos, cadena de hash del libro, saldo de la 1310 y las comprobaciones C1..C24 (código, resultado y las dos vías). También tras deshacer. El escenario espeja producción: un modelo con ambos sabores y ventas enviadas en los dos nombres, otro con solo el origen y uno bloqueado por existencia.

## 4. Alta de sabor

`catalogo.alta_sabor` (usada por la hoja de conteo, el bot y la web) consulta la detección antes de crear:

- IGUAL_NORMALIZADO o MUY_PROBABLE (sin confirmar): **no crea** y devuelve `estado: 'parecidos'` con la pregunta ("¿"Passion Fruit" es lo mismo que "Passionfruit"?") y los candidatos. Si el socio dice que sí, se vuelve a llamar con el nombre existente; si dice que no, se llama con `p_confirmar = true`.
- POSIBLE: crea y deja la pregunta pendiente en la cola.
- `p_confirmar = true`: crea y guarda los pares como negativo.
- Un nombre que ya es alias de un sabor unificado resuelve al sabor canónico.

## 5. Web

Catálogo, sección compacta **Sabores por revisar**: preguntas pendientes con el parecido y su motivo, qué tiene cada nombre (modelos y renglones vendidos), botones "Sí, es lo mismo" (con canónico elegible y nombre final opcional) y "No, son distintos", y "Deshacer" para las uniones recientes. Los modelos y clientes aparecen como pregunta pero su "sí" solo queda anotado.

## 6. Agente de Telegram

Hecho:

- Puertas SQL (rol `servidor`): `agente.sabor_pregunta()`, `agente.sabor_responder(clave, args)`, `agente.sabor_deshacer(clave, args)`. Verifican al socio por su id de Telegram, contestan por el mismo núcleo que la web (canal `telegram`) y devuelven el `aviso_grupo` ya redactado (unió, son distintos, bloqueado, deshizo). Sin tarjeta.
- `src/dominio/agente/sabores.ts`: lector de "sí / no / no sé" en lenguaje natural sin IA (ante la duda devuelve `no_se`: no unifica ni descarta), textos de la pregunta, reglas para el prompt y la fila del catálogo de intenciones (`DEF_INTENCION_SABOR`: sin confirmación, solo socios, reversa directa).

**Cableado** en el carril aprendizaje (16-nov; ver docs/aprendizaje-alta-bot.md): pregunta por chat (`agente.sabor_preguntar_chat`), respuesta con el `pregunta_id` de la memoria del servidor (`agente.sabor_responder_chat`), aviso al grupo y deshacer en 10 minutos. Lista original de lo que faltaba:

1. Agregar la intención `sabor_respuesta` a `intenciones.ts`, `esquemas.ts`, `catalogo_intenciones.ts` (con `DEF_INTENCION_SABOR`), `plantillas.ts` y `resolucion.ts`, y subir `VERSION_PROMPT` con `REGLAS_PROMPT_SABORES`.
2. Memoria de "qué pregunta espera respuesta" por chat (guardar el `pregunta_id` que devolvió `agente.sabor_pregunta` al preguntar y consumirlo con la siguiente respuesta).
3. Llamar a las tres puertas desde `src/infra/agente/postgres.ts` y mandar `aviso_grupo` al grupo.
4. Un disparador que haga la pregunta (por ejemplo, al terminar `api.duplicados_escanear` o al pedir "pendientes").

## 7. Aplicar los dos pares aprobados

Después del despliegue (con la migración ya aplicada):

```
RTM_DB_URL='postgres://postgres:...@host:5432/postgres' node scripts/catalogo/unificar-aprobados.mjs --verificar
RTM_DB_URL='postgres://postgres:...@host:5432/postgres' node scripts/catalogo/unificar-aprobados.mjs --aplicar
```

`--verificar` es solo lectura (estado, plan por modelo y bloqueos). `--aplicar` corre en una transacción con guarda: si cambia la huella de lo inmutable, hace rollback. Es idempotente. `--sql-salida archivo.sql` escribe el mismo SQL para `supabase db query --linked -f`. Después de aplicar, ejecutar `select api.duplicados_escanear('sabor')` (como socio) para dejar en la cola el resto de preguntas.

## Orden de operación en producción

Es importante respetar el orden:

1. **Desplegar las migraciones** con `node scripts/despliegue/desplegar.mjs ... --incluir-todo` (la nube puede tener una migración posterior a las de la unificación y `db push` exige `--include-all`). Aditivas, sin tocar datos: `20261115300000`, `300100`, `300200`, `500000` (parche).
2. **Unificar los dos pares aprobados**: `unificar-aprobados.mjs --verificar` (solo lectura) y, si no hay bloqueos, `--aplicar` (una transacción con guarda de huella; si dice "ya deshecho", ver `--reaplicar`).
3. **Solo después** `api.duplicados_escanear('sabor')` (como socio). Si el escaneo corriera antes, dejaría las preguntas de esos dos pares en la cola y un socio podría contestarlas por la vía normal; el desempate de arriba evita que "Passion Fruit" pierda contra "Passionfruit", pero el camino aprobado es el único previsto para esos dos pares.

## 8. Fase posterior: clientes y modelos

Solo se detectan y se preguntan. La unión mueve saldos, precios del tabulador, pedidos, cobros y asientos: necesita su propio diseño (cuenta de cliente destino, reasignación de partidas abiertas, historial de precios, reversa) y una auditoría contable aparte. Hasta entonces la respuesta "sí" queda como `confirmado_igual`.

## Costos de despliegue

Ninguno por sí mismo: la rama no hace push ni toca Vercel. Al desplegar, el cambio lleva migraciones `20261115300000`, `20261115300100`, `20261115300200` y `20261115500000` (aditivas) y un build de la web.
