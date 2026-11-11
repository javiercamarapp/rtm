# Informe de la fase F1

Fecha: 10-nov-2026. Alcance: catálogo, clientes con dueño, costos y precios con vigencia, inventario con costo promedio, roles y RLS, importador determinista, pantallas de F1 (laptop 1440 y móvil básico) y plan alterno del enlace mágico (`auth/confirm`). Todo local: sin remoto, sin push, sin Vercel, sin cuentas de pago, sin proyectos en la nube.

## Respuestas del dueño aplicadas durante la corrida (preguntas marcadas como RESUELTAS)

| Tema | Decisión aplicada |
|---|---|
| "Fuera de catálogo" (Waka Elite, IPLAY Burst 45K, Nexa Ultra 40K, Flavor Beast, Waka Icon Slim, Waka GO Mundialista) | RESUELTA: es **sin disponibilidad ahora**, no descontinuado. Estado reversible del modelo (`disponible` / `sin_disponibilidad`, con botón y diálogo propio); el modelo y los precios de sus clientes se conservan. |
| Equivalencias entre listas | RESUELTA: **no hay**. El catálogo solo unifica nombres idénticos tras normalizar mayúsculas, espacios y acentos (hoy 4: Nexa 50K, IPLAY Box Pro Max 50K, Waka Blade 33K y Geek Bar 2GO 50K); todo lo demás se importa como modelo distinto con su lista de origen (39 de Angelo, 32 de Javier, 4 comunes). Única excepción decidida una por una: "Geek Bar" de la lista de Campeche = Geek Bar 2GO 50K. |
| Campeche Vapes | RESUELTA: un solo cliente (alias confirmado "Empire Vapes" y "el campechano"). La lista anterior (que coincidía con costos de Isaac) está **descartada**: no se importa como vigente y el cliente conserva solo una nota. Tabulador correcto (14 líneas, vigencia 2026-11-10). La utilidad mensual de ≈ $30,000 se calculó con la lista anterior: **hay que recalcularla**, no se usa como cifra. |
| Cancún y el archivo `text-A451…` | RESUELTA: Cancún lleva **copia** del tabulador de Campeche (origen marcado en cada línea; puede divergir con su propio historial, igual que Happy Spot con Fer Vazquez). El archivo `text-A451…` queda como **lista de precios sin dueño** (referencia, no vigente) en `catalogo.lista_sin_duenio`. |
| Happy Spot | RESUELTA: cliente de Javier con precios iguales a Fer Vazquez (copia). Sus ≈ $8,000 de utilidad al mes son un dato ilustrativo y no se usan como cifra. |
| Karen / Vapemate | RESUELTA: un solo proveedor, `Karen`, con alias **Vapemate**. "Mr Cactus" **no** es alias (si alguien lo escribe, se pregunta). |
| Acento | RESUELTA: neutro estricto por defecto; el lila queda conmutable. |
| Inventario y Omar | "Bodega Omar" como ubicación; Omar = Omar Yacaman, desactivado hasta M2; sin reposiciones 2 a 1; costos de Karen "supuesto" desde 2026-11-10. |

## Lo que se hizo

1. **Esquema (migraciones 0002 a 0006, pgTAP).** `catalogo` (socio, marca, modelo con alias y disponibilidad, sabor y alias, SKU, proveedor con alias, costo con vigencia por rango excluyente y motivo cuando no es de lista, cliente con dueño, alias de cliente, destinos, tabulador con vigencia, historial externo, lista sin dueño, config, persona_bodega, ubicaciones, dim_fecha) y `operacion` (evento con folio E sin huecos, movimientos de inventario de solo inserción, existencia por modelo y por SKU y ubicación, conteo con fecha y hora obligatorias). T1 (solo inserción) y T2 (costo promedio ponderado móvil con residuo exacto, existencia no negativa por modelo, SKU y ubicación, fechas no retroactivas). Escritura solo por funciones `SECURITY DEFINER` idempotentes (`fijar_costo`, `fijar_precio`, `agregar_alias`, `fijar_disponibilidad`, `registrar_movimiento`, `reversar_evento`, `abrir_conteo`, `cerrar_conteo`). Cifras de G3, G4 y G5 verificadas con valores del documento de Angelo (915,462; 13,146,038; inventario en 0.00 exacto; 1,524 piezas y $139,516.45 tras el conteo).
2. **Roles y RLS.** RLS forzada y cero privilegios en todas las tablas; `api.*` (lecturas con `exigir_rol(['socio'])`); rol `servidor` sin BYPASSRLS; esquema `omar` con lista blanca (`v_mercancia`, `v_mis_precios`) preparado y **cerrado** (cero filas mientras Omar esté desactivado); pruebas de aislamiento (omar activo simulado solo ve `omar.*`, lista negra de columnas por nombre y por `pg_depend`, anon sin nada). **`registrar_intento_login` ya no es ejecutable por anon**: el login usa el rol `servidor` (conexión directa de Postgres, `SERVIDOR_DATABASE_URL`, nunca `NEXT_PUBLIC_`). Spike del pooler reproducible con `node scripts/entorno/spike-pooler.mjs`: `servidor` entra por Supavisor en modo transacción (usuario `servidor.pooler-dev`, puerto 55329), ejecuta solo lo concedido y no lee tablas.
3. **Importador determinista** (`npm run importar`, `importar:verificar`, `importar:idempotencia`). Lee en tiempo de ejecución el documento de Angelo, la lista de Javier con sus archivos `text-*.txt` y los 17 costos de Karen; solo nombre y precios. Verificado con código sobre las fuentes reales: **43 costos de Isaac, 19 clientes, 179 líneas de precio, 12 con margen cero, 17 costos de Karen, 0 márgenes que no sean precio menos costo, 0 costos de renglón distintos de la tabla**. Idempotente (dos aplicaciones en una transacción revertida dejan las mismas filas). Cargado en la base local: 75 modelos, 26 clientes (19 de Angelo y 7 de Javier), 259 precios vigentes, 60 costos, 21 alias de modelo (4 ambiguos), 7 de cliente. Los datos reales no se escribieron en ningún archivo versionado; los fixtures de pruebas y capturas son ilustrativos.
4. **Pantallas** (sistema de diseño de F0, claro y oscuro, movimiento reducido): Catálogo y precios, Clientes, Ficha de cliente (tabulador, márgenes contra Isaac y Karen, historial, línea escalonada), Inventario (por modelo y por sabor y ubicación, "Sin dato" donde no hay movimientos). Componentes: `CifraComprobada`, `ExplicarCajon` ("Explicar este número", 440 px), `DataTable` (cargando, vacío, error), `ConfirmDialog` propio, `EstadoTexto`, gráficas SVG propias de barras y de línea con tabla equivalente.
5. **Plan alterno del enlace mágico**: ruta `auth/confirm` (token_hash + botón; el GET no consume el enlace), misma regla de cuenta activa y `next` solo propio; plantilla de correo lista pero **inactiva** (`supabase/templates/magic_link_confirm.html`). Probada en WebKit iPhone 16 Pro (402x874), Chromium con tamaño de plegable cerrado (344) y abierto (880) y laptop.
6. `npm run verificar` en verde (10 pasos) y 64 capturas en `docs/capturas/f1/` con `manifest.md`.

## Cómo se verificó

Última corrida de `npm run verificar` (la base ya estaba corriendo; con `--mantener`):

```
OK     Tipos (tsc) (2.2 s)
OK     Lint y fronteras entre capas (eslint) (2.0 s)
OK     Guardas estaticas de diseno y dominio (0.1 s)
OK     Escaner de secretos y correos (0.5 s)
OK     Pruebas unitarias y de contratos (vitest) (1.2 s)          150 pruebas en 18 archivos
OK     Entorno local (.env.local y rol servidor) (2.1 s)
OK     Pruebas de base de datos (pgTAP) (2.6 s)                   128 afirmaciones en 6 archivos
OK     Importador: idempotencia con fixtures (2.6 s)
OK     Importador sobre las fuentes reales (43 costos, 19 clientes, 179 lineas, 12 en cero, 17 de Karen) (0.5 s)
OK     Pruebas de pantallas y acceso (Playwright) (127.0 s)       45 pasadas, 1 omitida (solo aplica al plegable)
VERIFICAR: OK (10 pasos, 142.3 s)
```

Playwright: laptop 1440 (acceso F0 más pantallas F1), iPhone 16 Pro (WebKit), plegable cerrado y abierto (Chromium móvil): sin scroll horizontal, objetivos táctiles de 44 px, campos de 16 px, el cajón cabe en pantalla, cambio de plegado a desplegado en vivo sin recarga ni pérdida de lo escrito, nunca un `confirm()` nativo. Las capturas se regeneran con `npm run capturas:f1` (reinicia la base, carga fixtures y datos de demostración, captura y restaura las listas reales).

**Falta probar el enlace en un teléfono real** (iPhone con la app de correo instalada y el Samsung plegable): lo que se probó es el emulador de Playwright. La plantilla del correo con `auth/confirm` no está activada; se activa solo si el enlace actual falla en el teléfono real.

## Desviaciones de la especificación

1. **RLS sin políticas permisivas** (denegar por omisión) en lugar de "una política por tabla y comando": ningún rol de la web toca tablas; todo pasa por funciones `SECURITY DEFINER` con `exigir_rol`. Más estricto, probado por pgTAP.
2. Ids `bigint identity`, no `uuid`.
3. Estados del modelo `disponible | sin_disponibilidad` (la spec decía `vigente | sin_disp_proveedor | descontinuado`) por decisión del dueño; los modelos tienen `lista_origen`.
4. **"Omar" a secas es ambiguo** (la spec manda: se pregunta) aunque el documento de Angelo dice que es el de la bodega.
5. `exigir_rol` acepta el canal `importacion` (sesión `postgres` con la bandera `rtm.canal`); es la única vía del importador y no existe para la web.
6. En `evento` y `movimiento_inventario` no se revoca `UPDATE` al dueño (una llave foránea exige el privilegio); el trigger T1 lo bloquea incluso como propietario (probado).
7. `lote_id` sin llave foránea todavía (`operacion.lote` llega con las compras). El cierre de conteo reparte el residuo para que el ajuste neto sea exacto (12 piezas = $1,098.55 en G4); no hay pantalla de conteo en F1.
8. Esquema `omar`: solo `v_mercancia` y `v_mis_precios` (`v_mi_cuenta` necesita tablas de F2/M2).
9. Estados de inventario en palabra: "Sin existencia", "Con existencia", "Sin dato" (los de "Se acaba", "Poca existencia" y "Sin movimiento" necesitan historia, M2). De las 5 gráficas de M1 se hicieron 2 (barras y línea); la navegación por teclado es por la tabla equivalente, no barra por barra.
10. Capturas del teléfono a escala 2; perfiles del plegable 344x882 y 880x860 (la spec decía 352x860 y 800x860).
11. Los alias de modelos del documento de Angelo viven como reglas de nombres en código (`alias_angelo.ts`, validadas en cada importación contra su tabla de costos); un alias que choca con el nombre de un modelo de la lista de Javier se importa como ambiguo.
12. `verificar` regenera `.env.local` en cada corrida (le pone contraseña local al rol `servidor`, que un `db reset` borra).

## Problemas y avisos

- **Docker:** había otro Supabase local ajeno (`likida-bitacoras`, 6 contenedores) corriendo; no se detuvo ni se tocó. RTM usa los puertos 55320 a 55329. Al terminar, el Supabase de RTM queda detenido.
- La base local de RTM contiene las listas reales (en el volumen de Docker, no en el repo). `npm run capturas:f1` la reinicia y restaura con `npm run importar`.
- El spike del pooler se hizo contra Supavisor local; **no se probó en la nube** (no se crean proyectos). Plan B documentado: si el pooler hospedado rechazara un rol propio, el limitador usa la conexión directa (puerto 5432) o el modo sesión; como último recurso, `service_role` solo dentro de un módulo de infra (spec sección 6).
- El Excel de Angelo con "Empire" no está en este equipo: no se importó nada de ahí.

## Consumo

Alrededor de 115 llamadas a herramientas y 50 minutos de reloj de una sola sesión. Builds de Vercel: 0. Despliegues: 0. Se descargó la imagen `supabase/supavisor` (solo para el spike; el pooler quedó apagado por omisión).

## Preguntas para la Parada 2 (listado exacto)

Del plan (15-PREGUNTAS-ABIERTAS, sección A) siguen abiertas:

1. **Angelo y Javier:** monto exacto de cada transferencia a Isaac por la compra inicial; ¿los $139,680 incluyen los $56,000 de Javier? (prueba G3).
2. **Angelo / Omar:** fecha y hora del conteo de 1,524 piezas y si fue antes o después de las primeras ventas.
3. **Angelo:** costo vigente de Nexa 50K con Isaac: la lista dice $130 y la compra inicial se facturó a $90 (hoy se importa $130 de lista; $90 queda para la compra inicial con motivo).
4. **Angelo:** remisión de Isaac por sabor de la compra inicial (cierra las 12 piezas del puente). El dueño dijo que no hay remisión: ¿se deja el puente abierto con responsable?
5. **Ambos:** fecha propuesta de pago a Omar cuando el neto le favorece (por defecto lunes).

Datos en conflicto o dudosos que encontré al importar:

6. **Precios menores que el costo si fueran el mismo modelo:** Fer Vazquez (y Happy Spot) tienen "Box Pro Max" a $175, "Box Pro 15" a $200 y "X-Box 50k" a $250; el costo de Karen de "iPlay Box Pro Max 50K" es $195 y el de Isaac $220. ¿"Box Pro Max" de Javier es el mismo modelo que "IPLAY Box Pro Max 50K"? Hoy no se unifican (el nombre no es idéntico) y el margen queda "Sin dato".
7. **Optimus:** la lista de Javier dice 80,000 hits y la de Angelo "Waka Optimus 100K". Son modelos distintos en el catálogo; ¿se confirma una equivalencia?
8. **Nombres de Javier sin par idéntico en la lista de Angelo** (Burst, Blade, Waka 15, Smash Go, Slim, Icon, PA30000, Elite, Waka 12, Go, Waka 30, Waka 36, Waka 50, Waka 100, Icon Slim, Jupiter, Blast, etc.): por la regla del dueño son modelos distintos, así que los costos de Karen solo comparan contra los precios de la lista de Javier y los márgenes de los clientes de Angelo contra Karen quedan "Sin dato". ¿Quieren confirmar equivalencias una por una (los alias "burst", "waka 100" y "box pro max" ya quedan como ambiguos porque chocan)?
9. **Happy Spot** no tiene precio de Nexa 50K definido (Fer Vazquez lo tiene a $150): ¿mismo precio?
10. **Cancún** lleva copia del tabulador de Campeche por regla del dueño (y su dato "Waka 15 a $200" ya no se usa porque el modelo de Campeche se llama "Waka 15K"): ¿se confirma con el cliente?
11. **Campeche Vapes:** recalcular la utilidad mensual de ≈ $30,000 con la lista correcta; y ¿existen precios de "Empire" con fecha posterior en el Excel de Angelo (no está en este equipo)?
12. **Márgenes cero:** hay 12 líneas de la lista de Angelo con margen cero contra Isaac (el importador las imprime con `npm run importar:verificar`; no se listan aquí por no versionar datos de clientes): ¿son intencionales (se compensan con Karen)?
13. **Costos de Karen:** los 17 son "supuesto" desde 2026-11-10; ¿tienen lista o documento con fecha? Instabar 70K, Fifty Bar, Snowwolf, Lost Mary Ultrasonic y Elfbar 40K no existen en la lista de Isaac (se crearon como modelos de la lista de Javier).
14. **Nombre completo del cliente repetido:** el nombre completo del cliente repetido vive solo en el archivo local de decisiones del importador (no en el repo); ¿es el definitivo?
15. **"Omar" a secas:** el documento de Angelo dice que es el de la bodega y la especificación manda preguntar (Omar Yacaman vs Omar Aguilar); ¿se confirma que el agente siempre pregunte?
16. **Teléfono real:** ¿pueden probar el enlace en el iPhone de Javier y Angelo (con la app de correo instalada) y en el Samsung plegable? Con eso se decide si se activa la plantilla de `auth/confirm`.
