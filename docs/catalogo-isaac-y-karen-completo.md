# Catalogo de Isaac (Remate) y Mr Cactus de Karen completos (15-nov)

Rama `feat/catalogo-isaac-y-karen-completo`. Nada se aplico a produccion ni se hizo push; todo se probo en una base propia de prueba (Postgres 17 local, puerto 64400, con el catalogo de 87 modelos y 21 marcas de produccion del 14-nov y los mismos ids).

## Reglas aplicadas

- Marcas, modelos y sabores en MAYUSCULAS (solo presentacion, como en `docs/fusion-repetidos.md`).
- Los IGUALES se fusionan (mismo nombre salvo mayusculas, espacios, guiones o acentos: se usa el que ya existe; por ejemplo `Grapefruit Berry` entra como `Grape Fruit Berry`).
- Los PARECIDOS se preguntan: un modelo dudoso no se crea ni se asigna (sale en "por confirmar"); un sabor parecido entra a la cola de duplicados de los socios (`catalogo.escanear_duplicados`), nunca se une solo.
- Lo que falta en nuestro registro queda en 0: se crea el sku, la existencia sigue en 0.
- Sin precios: ni la tienda de Karen ni el PDF de Isaac se leen por precio.

## Isaac (PDF Catalogo_Remate.pdf)

El PDF trae 23 modelos (24 hojas con la portada), leidos a ojo pagina por pagina: `scripts/catalogo/isaac-remate.json` (289 sabores). Ningun modelo del PDF viene sin sabor. Mas **Waka Blast 45K** por instruccion del dueno: modelo APARTE (no se une a Waka Blast ni a Waka Blast 50K), de Isaac, sin sabores (se registra sin sabor) y con costo de lista de Isaac **210 registrado como SUPUESTO** (confirmar si 210 es costo o precio).

Decisiones del dueno (15-nov, relevadas por otra sesion): FUNKY REPUBLIC es de 7K puffs y modelo propio (`FUNKY REPUBLIC 7K`, no es Funky Republic Fi 3K); EBDESIGN TE6000 es modelo propio distinto de ELFBAR BC5000. **Por confirmar: su relacion con Elf Bar TE6000 de Karen** (no se fusiona).

| Cifra | Valor |
| --- | --- |
| Modelos en la fuente y registrados | 24 (23 del PDF y Waka Blast 45K); por confirmar: 0 |
| Sabores del PDF / skus registrados | 289 / 289, todos con existencia 0 y todos disponibles en el stock de Isaac |

Stock disponible de Isaac: tablas `proveedores.stock_isaac_modelo` y `proveedores.stock_isaac_sabor` (migracion aditiva `20261120000000_stock_isaac.sql`, sin columnas de dinero, pgTAP `c1_001_stock_isaac`), `api.prov_tablero_isaac()` y la pestana Isaac de `/proveedores/stock`. Sin foto por ahora: el PDF solo trae banners.

Notas de lectura: "Tropical Spoal", "Osk Ice", "Spoal Cloudd", "Los Ice" (Geek Bar 6000) y "Pomo Brzz" se transcribieron como estan impresos. Aroma King 700 y 3000 muestran una botella con un sabor que no esta en su lista: no se agrego. Puff XXL se registra bajo la marca PUFF BAR.

## Mr Cactus (Karen)

Fuente: lectura de la tienda del 14-nov 21:42 (49 modelos); la direccion privada no esta disponible en esta sesion, la pasada horaria repite la lectura.

| Cifra | Valor |
| --- | --- |
| Modelos en la tienda | 49 |
| Sabores (disponibles y agotados) | 1,020 (242 disponibles, 778 agotados) |
| Fotos de modelo | 49 de 49 cargadas; faltan 0 |
| Modelos conciliados contra el catalogo | 26 (17 ya conciliados + 9 ligados por el dueno) |
| Modelos nuevos | 23 (22 de la conciliacion + IPLAY BIG MAX, 1,000 puffs) |
| Por confirmar | 0 |
| Skus registrados (sabores unicos, existencia 0) | 1,019 |

Ligaduras confirmadas por el dueno (`scripts/catalogo/ligaduras-karen.json`; se escriben en `proveedores.modelo.canonico_id` con `proveedores.ligar_modelo_karen`, migracion `20261120000100`; no se crean ni unifican modelos ni se borran candidatos): X-Box Pro Max 50K -> 82; Fifty Bar -> 146; Snowwolf -> 147; Instabar Be 70K -> 145; iPlay X-Box -> 100 (IPLAY Box 4K; "IPLAY Box" es lo mismo que "iPlay X-Box"); y **por revisar** (eran ambiguos): iPlay X-Box Pro -> 98, Lost Mary Ultrasonic 35K -> 105, Waka Pro 30K -> 151, Waka Sopro 15K -> 120 (Waka DM 15K, 90, queda de candidato secundario). Correcciones del dueno: **iPlay Big Max NO es IPLAY Max (111)**: IPLAY Max es de 300 puffs y Big Max de 1,000; se da de alta como modelo nuevo IPLAY BIG MAX. **138 X-Box 50k: nombre/puffs por corregir** (en realidad es de 4K puffs y marca IPLAY), posible duplicado del 100; decide el dueno, no se renombra ni se fusiona ni se usa en ninguna ligadura. Las ligaduras a 82 y 98 son coherentes con esto.

Los sabores de los modelos ligados se concilian contra el modelo ligado: iguales se fusionan, parecidos a la cola de duplicados (256 preguntas de Karen y 122 de Isaac en la base de prueba; los socios deciden). Fotos: los modelos ligados ya tenian la foto de Karen asignada en `fotos-modelos.ts` salvo 138 y 105 (con foto "probable" de otra fuente, no se cambio); IPLAY BIG MAX se muestra con la foto de la tienda por su identificador (`big-max`) y su foto canonica por id se asigna con la siguiente pasada del vigilante.

## Actualizacion horaria (lista, sin builds de Vercel)

Reutiliza el vigilante `scripts/proveedores/vigilar-karen.mjs`, que ahora acepta `--catalogo`: despues de leer la tienda registra en el catalogo los modelos y sabores nuevos (mismo plan, mismas reglas) en la misma pasada, sin peticiones extra. Guardas que ya trae: 1 pasada por hora, robots.txt, pausa de 1.1 s, tope de 40 peticiones al dia, sin precios, sin Telegram.

Piezas: `scripts/proveedores/produccion.sh horaria` (una pasada), el interruptor `lectura_proveedores` (hoy apagado) y un disparador. Disparador recomendado en la Mac (sin costo de nube), `~/Library/LaunchAgents/com.rtm.proveedores.plist` con `StartInterval` 3600 que ejecuta `/bin/sh -c 'cd <carpeta ligada> && sh scripts/proveedores/produccion.sh horaria'` con `DATABASE_URL` y `RTM_PROV_ENV` en el entorno del agente (archivo con permisos 0600 fuera del repo). Solo corre con la Mac encendida; la alternativa sin Mac es pg_cron + pg_net (ver `docs/pagina-karen.md`), que requiere autorizar extensiones. Una pasada fallida no escribe nada y queda en el aviso interno de salud.

## Como se prueba

- `npx vitest run test/unit/proveedores "src/app/(socio)/proveedores" test/contratos`, `npx tsc --noEmit`, `npx eslint`, `node scripts/ci/guardas.mjs`, `node scripts/ci/escaner-secretos.mjs`.
- Carga de ensayo: `RTM_DB_URL=<base de prueba> node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac|karen --verificar|--aplicar` (la segunda corrida debe decir 0 creados).
- Lista de faltantes de costo y precio: `psql "$DATABASE_URL" -f scripts/proveedores/faltantes-precio-costo.sql` (solo lectura).
