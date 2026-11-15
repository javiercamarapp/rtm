# Catalogo de Isaac (Remate) y Mr Cactus de Karen completos (15-nov)

Rama `feat/catalogo-isaac-y-karen-completo`. Nada se aplico a produccion ni se hizo push; todo se probo en una base propia de prueba (Postgres 17 local, puerto 64400, con el catalogo de 87 modelos y 21 marcas de produccion del 14-nov y los mismos ids).

## Reglas aplicadas

- Marcas, modelos y sabores en MAYUSCULAS (solo presentacion, como en `docs/fusion-repetidos.md`).
- Los IGUALES se fusionan (mismo nombre salvo mayusculas, espacios, guiones o acentos: se usa el que ya existe; por ejemplo `Grapefruit Berry` entra como `Grape Fruit Berry`).
- Los PARECIDOS se preguntan: un modelo dudoso no se crea ni se asigna (sale en "por confirmar"); un sabor parecido entra a la cola de duplicados de los socios (`catalogo.escanear_duplicados`), nunca se une solo.
- Lo que falta en nuestro registro queda en 0: se crea el sku, la existencia sigue en 0.
- Sin precios: ni la tienda de Karen ni el PDF de Isaac se leen por precio.

## Isaac (PDF Catalogo_Remate.pdf)

El PDF trae 23 modelos (24 hojas con la portada), leidos a ojo pagina por pagina: `scripts/catalogo/isaac-remate.json` (289 sabores). Ningun modelo del PDF viene sin sabor (Lush TFN 2500 y Hyppe Bar 300 traen uno solo, Fogx 320 trae tres). Mas **Waka Blast 45K** por instruccion del dueno: modelo APARTE (no se une a Waka Blast ni a Waka Blast 50K), de Isaac, sin sabores (se registra sin sabor) y con costo de lista de Isaac **210 registrado como SUPUESTO** (dato de palabra; confirmar si 210 es costo o precio).

| Cifra | Valor |
| --- | --- |
| Modelos en la fuente | 24 (23 del PDF y Waka Blast 45K) |
| Modelos que se registran | 22 (21 del PDF y Waka Blast 45K) |
| Por confirmar | 2: FUNKY REPUBLIC (sin puffs en la hoja; la caja dice Ti7000; el catalogo ya tiene Funky Republic Fi 3K) y EBDESIGN TE6000 (misma linea que Elf Bar TE6000 de Karen) |
| Sabores en el PDF | 289 (los de los dos modelos por confirmar, 27, quedan fuera hasta que se decida) |
| Sabores / skus registrados | 262 skus, todos con existencia 0 y todos disponibles en el stock de Isaac |

Stock disponible de Isaac: tablas `proveedores.stock_isaac_modelo` y `proveedores.stock_isaac_sabor` (migracion aditiva `20261120000000_stock_isaac.sql`, sin columnas de dinero, pgTAP `c1_001_stock_isaac`), `api.prov_tablero_isaac()` y la pestana Isaac de `/proveedores/stock` con el mismo formato que Karen. Sin foto por ahora: el PDF solo trae banners con la lista de sabores.

Notas de lectura: "Tropical Spoal", "Osk Ice", "Spoal Cloudd", "Los Ice" (Geek Bar 6000) y "Pomo Brzz" se transcribieron tal como estan impresos; si son erratas del catalogo, corregirlas en el JSON antes de cargar. Aroma King 700 y 3000 muestran una botella con un sabor que no esta en su lista (Watermelon Ice, Cool Mint): no se agregaron. Puff XXL se registra bajo la marca PUFF BAR.

## Mr Cactus (Karen)

Fuente: lectura de la tienda del 14-nov 21:42 (49 modelos). La direccion privada no esta disponible en esta sesion, asi que no se hizo una lectura nueva; la pasada horaria (abajo) la repite.

| Cifra | Valor |
| --- | --- |
| Modelos en la tienda | 49 |
| Sabores (todos, disponibles y agotados) | 1,020 (242 disponibles, 778 agotados) |
| Fotos de modelo cargadas | 49 de 49 (`public/proveedores/karen`, mapa `src/config/fotos_karen.ts`); faltan 0 |
| Modelos que se registran en el catalogo | 39: 17 ya existian (15 exactos y Waka Steel e Icon Slim por el diccionario Waka) y 22 modelos nuevos |
| Sabores / skus registrados | 779 (tras juntar repetidos exactos), todos en 0; 438 sabores nuevos |
| Por confirmar (NO se unifican ni asignan) | 10 modelos con 241 sabores: los 9 dudosos de la seccion 3 de `docs/conciliacion-marcas-mrcactus.md` y ademas Waka Sopro 15,000, que tiene dos candidatos (Waka 15K y Waka DM 15K) |
| Parecidos de sabores en la cola de duplicados | 207 preguntas de Karen y 117 de Isaac en la base de prueba (los socios deciden; nunca se unen solos) |

La disponibilidad y la foto por sabor/modelo las guarda el vigilante en `proveedores.modelo` y `proveedores.variante` (la pagina `/proveedores/stock` las muestra); el catalogo propio solo recibe modelo y sabor.

## Actualizacion horaria (lista, sin builds de Vercel)

Reutiliza el vigilante `scripts/proveedores/vigilar-karen.mjs`, que ahora acepta `--catalogo`: despues de leer la tienda registra en el catalogo los modelos y sabores nuevos (mismo plan, mismas reglas) en la misma pasada, sin peticiones extra. Guardas que ya trae: 1 pasada por hora, robots.txt, pausa de 1.1 s, tope de 40 peticiones al dia, sin precios, sin Telegram.

Piezas: `scripts/proveedores/produccion.sh horaria` (una pasada), el interruptor `lectura_proveedores` (hoy apagado) y un disparador. Disparador recomendado en la Mac (sin costo de nube), `~/Library/LaunchAgents/com.rtm.proveedores.plist` con `StartInterval` 3600 que ejecuta `/bin/sh -c 'cd <carpeta ligada> && sh scripts/proveedores/produccion.sh horaria'` con `DATABASE_URL` y `RTM_PROV_ENV` en el entorno del agente (archivo con permisos 0600 fuera del repo). Solo corre con la Mac encendida; la alternativa sin Mac es pg_cron + pg_net (ver `docs/pagina-karen.md`), que requiere autorizar extensiones. Una pasada fallida no escribe nada y queda en el aviso interno de salud.

## Como se prueba

- `npx vitest run test/unit/proveedores "src/app/(socio)/proveedores" test/contratos`, `npx tsc --noEmit`, `npx eslint`, `node scripts/ci/guardas.mjs`, `node scripts/ci/escaner-secretos.mjs`.
- Carga de ensayo: `RTM_DB_URL=<base de prueba> node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac|karen --verificar|--aplicar` (la segunda corrida debe decir 0 creados).
- Lista de faltantes de costo y precio: `psql "$DATABASE_URL" -f scripts/proveedores/faltantes-precio-costo.sql` (solo lectura).
