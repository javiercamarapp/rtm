# Pagina unica "Lo que hay en Karen"

Ruta: `/proveedores/inventario` (solo socios). Sustituye la pagina de tarjetas y tabla anterior; la lista para clientes sigue existiendo dentro de un panel colapsable.

## Que muestra

| Bloque | Origen |
|---|---|
| Barra de lectura: estado, ultima lectura, peticiones de hoy contra el tope de 40, "Actualizar ahora", "Crear orden de compra a Karen" | `api.prov_inventario().frescura` |
| Avisos y recomendaciones (modelo nuevo, sabor llegado o agotado, nombres por confirmar, "conviene pedir") | eventos de la base + `recomendaciones` de `api.prov_tablero`. La web solo redacta; no calcula |
| Busqueda en vivo (modelo, marca, sabor, sin acentos), marca multiseleccion con conteo, disponibilidad, solo lo que vendemos, nuevos esta semana, con o sin existencia nuestra, mostrar caladas, orden | estado en la URL (`q`, `marca`, `disp`, `vendemos`, `nuevos`, `exi`, `caladas`, `orden`, `m`) |
| Rejilla de tarjetas: foto uniforme 4:3, marca, nombre, sabores disponibles, disponibilidad, existencia propia y cobertura | `api.prov_tablero().modelos` |
| Panel del modelo: sabores (disponible o agotado, ultimo cambio, cuanto vendemos y cuanto tenemos por sabor), linea de tiempo, recomendacion, "Ordenar a Karen" | idem |
| Cambios recientes, promociones, nombres por confirmar | `api.prov_inventario()` |

## Reglas que no cambian

- El monitor NUNCA lee ni guarda precios o costos del proveedor ni actualiza costos solos: solo modelos, sabores, disponibilidad y cambios. La nueva funcion `proveedores.tablero_karen()` devuelve piezas, dias y conteos (pgTAP `033_karen_tablero` vigila que ninguna clave sea un importe).
- Ninguna cuenta se hace en TypeScript: ventas de 60 y 30 dias, cobertura (`existencia * 60 / ventas`, en dias), "vendemos" y las recomendaciones salen de SQL. Umbrales: al menos 6 piezas vendidas en 60 dias y 21 dias o menos de cobertura (o cero existencia).
- La lectura sigue APAGADA por el interruptor `lectura_proveedores`. Esta entrega no enciende nada.
- "Actualizar ahora" se bloquea en pantalla con mensaje claro y el servidor repite las comprobaciones: interruptor apagado, sitio bloqueado, tope de 40 al dia y 10 minutos de enfriamiento. Despues corre la misma tarea `inventario-proveedores` (reclamo idempotente por minuto), que a su vez respeta el interruptor y el presupuesto.

## Fotos

Procedencia: cada imagen es la foto del modelo en la pagina publica del proveedor (Karen), bajada una sola vez por `scripts/proveedores/bajar-fotos.mjs` y guardada en `public/proveedores/karen/<clave>.webp`. El mapa `src/config/fotos_karen.ts` va de la clave del modelo (su identificador corto) a la ruta local. La pagina nunca enlaza imagenes del sitio de origen. La direccion del sitio vive solo en la variable privada `INVENTARIO_PROVEEDORES_FUENTE`: no esta en el repo, en los registros ni en estos documentos.

El script: respeta robots.txt (del sitio y del servidor de imagenes), agente de usuario generico sin datos personales, 1 solicitud por segundo como maximo, sin sesion ni cookies, no vuelve a bajar lo que ya existe, descarta del catalogo todo salvo titulo, identificador corto e imagen, optimiza a webp de 800 px o menos y menos de 150 KB y elimina EXIF, ICC y XMP. Cuenta como 2 peticiones del tope diario (robots y catalogo) mas una por imagen.

Uso (una sola vez, a mano, con la variable en el entorno o en un archivo local no versionado):

    node scripts/proveedores/bajar-fotos.mjs --seco                 # solo robots y catalogo, no baja nada
    node scripts/proveedores/bajar-fotos.mjs --env-file=<ruta>      # baja y actualiza el mapa

Revision obligatoria antes de confirmar los archivos: abrir cada `.webp` y comprobar que no muestra precios, telefonos, direcciones ni rostros. Una imagen con precio se borra (y su entrada del mapa) y el modelo queda con el marcador de iniciales.

Estado de esta entrega: la variable privada no estaba disponible en la sesion que construyo la pagina, por lo que no se bajo ninguna foto. El pipeline esta listo y probado sin red; las tarjetas muestran el marcador de iniciales hasta correr el script.

## Disparador horario de la lectura (NO instalado)

La tarea `inventario-proveedores` ya existe (`cada hora, minuto 02`, zona de Merida) y la corre el latido `/api/tareas/latido` con `Authorization: Bearer <TAREAS_SECRETO>`. Alguien debe llamar al latido cada pocos minutos. Opciones:

| Opcion | Como | Costo | Riesgo |
|---|---|---|---|
| pg_cron + pg_net en Supabase | `cron.schedule` que hace `net.http_get` al latido con el secreto en un secreto de Supabase | Sin builds de Vercel. Cada llamada es una invocacion de funcion (24 al dia por la hora, hasta 288 si el latido es cada 5 min) | El secreto vive en la base; pg_net es asincrono sin reintentos propios; si el proyecto se pausa, se detiene la lectura. Requiere activar extensiones (cambio externo: pedir autorizacion) |
| Cron de Vercel | `crons` en `vercel.json` apuntando al latido | Un push con ese cambio = 1 build. El plan Hobby solo permite 1 ejecucion al dia; con Pro se puede cada hora | Agrega un build por cada cambio de la lista; recordar la regla de costos de Vercel |
| launchd en la Mac | agente de usuario con `StartInterval` que hace `curl` al latido | Sin costo de nube | Solo corre con la Mac encendida y con red; el secreto queda en un archivo local (permisos 0600). Util para pruebas, no para produccion |

Recomendacion: pg_cron + pg_net (sin builds). Antes de encender: confirmar el interruptor `lectura_proveedores` y la variable `INVENTARIO_PROVEEDORES_FUENTE` en el servidor, verificar robots con `verificarRobots` y dejar `promociones_lectura` apagado hasta nueva orden.

## Pruebas

- `supabase/tests/database/033_karen_tablero.test.sql` (20 comprobaciones; corrida en una base temporal clonada y borrada al terminar).
- `test/unit/proveedores/tablero.test.ts` (filtros, URL, avisos, bloqueo de "Actualizar ahora").
- `test/unit/proveedores/bajar_fotos.test.ts` (robots, extraccion sin precios, optimizacion, una sola vez, 1 s de pausa, sin direccion en logs).
- `src/app/(socio)/proveedores/inventario/tablero-karen.test.tsx` (jsdom y axe: tablero, vacios, panel, barra de lectura).
- `test/e2e/integracion-db.spec.ts` se ajusto a la nueva pagina (no se corrio: Playwright pesado).

## Componentes para unificar con el rediseno de inventario

`TarjetaVape`, `FotoVape`, `IndicadorDisponibilidad` (tarjeta con foto uniforme), la barra de filtros de `TableroKaren` (busqueda, desplegable de marca con conteo, segmentos y chips) y `PanelVape` (panel modal). Estilos con prefijo `rtm-kr-` en `src/ui/estilos/karen.css`. API simple: reciben datos ya calculados y una funcion `onAbrir`.
