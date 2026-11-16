# Stock disponible de proveedores y vigilante horario de Karen

La direccion de la tienda de Karen es privada: vive solo en la variable `INVENTARIO_PROVEEDORES_FUENTE` (servidor y un archivo local con permisos 0600). No esta en este repositorio, ni en pruebas, registros o commits.

## La pagina

Ruta `/proveedores/stock` (solo socios; boton "Stock" en Proveedores). Muestra, por proveedor:

- Karen: modelos por marca y modelo en MAYUSCULAS, sabores disponibles ahora, disponible si o no, foto del modelo, "visto por ultima vez", cambios recientes (nuevo, agotado, de regreso), grafica animada de disponibilidad por marca, cuanto tienes en bodega y enlace "Ver en Inventario". Filtros en una linea (busqueda, marca, disponibilidad, nuevos).
- Isaac: su catalogo Remate (modelos y sabores disponibles, mismo formato que Karen, sin lectura en vivo); estado vacio claro hasta que se cargue. Ver `docs/catalogo-isaac-y-karen-completo.md`.
- Sin dato: donde no hay lectura se escribe "Sin dato".
- Precios: el monitor NO lee ni guarda precios del proveedor (regla del repo y prueba pgTAP `033_karen_tablero`). Por eso la pagina no muestra precio de lista ni "cambio de precio"; Omar y bodega nunca ven costos. Si el dueno decide guardar precios de lista, habria que cambiar esa regla y crear una tabla solo para socios; no se hizo.

La pagina "Lo que hay en Karen" (`/proveedores/inventario`) sigue existiendo para el detalle por sabor, recomendaciones de compra y la lista para clientes.

## Como se enciende (lo hace el dueno, nada de esto se hizo)

1. Aplicar las migraciones nuevas `20261116100000_alias_waka_modelos.sql` y `20261116100100_fotos_por_confirmar.sql` (aditivas). Son parte del flujo de despliegue autorizado.
2. Poner `INVENTARIO_PROVEEDORES_FUENTE` en el servidor (y `INVENTARIO_PROVEEDORES_CONTACTO`, opcional).
3. Encender el interruptor: `update seguridad.interruptor set activo = true where clave = 'lectura_proveedores'`. Dejar `promociones_lectura` apagado.
4. Programar la pasada horaria (ver "Disparador horario" en `docs/pagina-karen.md`; la opcion recomendada es pg_cron + pg_net, sin builds de Vercel).

## Como se corre el vigilante

Necesita `RTM_DB_URL` (rol servidor) y la variable de la fuente (entorno o `--env-file`).

    # Solo lectura: lee la tienda y dice que cambiaria. No escribe en la base ni en el repo.
    RTM_DB_URL=<url> npx tsx scripts/proveedores/vigilar-karen.mjs --verificar --env-file=<archivo-local>

    # Escribe: estado y eventos (proveedores.guardar_estado), avisos internos, foto diaria, fotos faltantes y cola de dudosas.
    RTM_DB_URL=<url> npx tsx scripts/proveedores/vigilar-karen.mjs --aplicar --env-file=<archivo-local>

Opciones: `--sin-fotos`, `--limite-fotos=N` (12 por pasada), `--forzar` (salta la guarda de una pasada por hora).

Que hace una pasada: revisa robots.txt, lee el catalogo publico (pausa de 1.1 s o mas, agente de usuario generico, sin cookies, tope de 40 peticiones al dia), detecta modelos nuevos y cambios de disponibilidad con el mismo motor de la tarea `inventario-proveedores` (confirmacion de cambios, sin avisos en la carga inicial), guarda el historial en `proveedores.evento`, genera avisos en la tabla interna (sin Telegram) y baja solo las fotos que faltan. Una foto se asigna a un modelo del catalogo solo si coincide marca, linea y puffs (o por el diccionario de alias Waka sin otros candidatos) y ese modelo no tenia foto; todo lo demas se registra en `proveedores.foto_pendiente` (se lee con `api.prov_fotos_pendientes()`). Nunca unifica modelos. Si la fuente no responde, el ciclo registra el fallo (aviso y contador de fallos seguidos) y el script termina sin tocar nada mas.

Despues de `--aplicar`: revisar a ojo cada `.webp` nuevo (sin precios, telefonos ni rostros) y commitear `src/config/fotos_karen.ts`, `src/dominio/catalogo/fotos-modelos.ts` y `public/proveedores/karen/`. Las fotos nuevas se agregan al repo, asi que llegan a produccion con el siguiente despliegue autorizado.

## Fotos de modelos sin foto

`scripts/proveedores/fotos-web.mjs` baja la foto de los modelos que siguen sin imagen a partir de candidatas revisadas a mano (`fotos-web-candidatas.json`), con las mismas reglas de cortesia, y valida tipo, tamano minimo de 300 px y proporcion. Los candidatos dudosos no se bajan: quedan en la cola del informe.

    node scripts/proveedores/fotos-web.mjs --verificar    # baja a memoria y valida; no escribe
    node scripts/proveedores/fotos-web.mjs --aplicar      # guarda public/modelos/<slug>.webp, actualiza la tabla y la procedencia en docs/fotos-modelos.md

## Como se verifica

- `npx vitest run test/unit/proveedores "src/app/(socio)/proveedores" test/contratos`
- pgTAP `supabase/tests/database/b2_001_alias_waka_y_fotos_pendientes.test.sql` (corrida en una base temporal clonada).
- Conciliacion de marcas contra la tienda: `docs/conciliacion-marcas-mrcactus.md` (`scripts/proveedores/conciliar-marcas.mjs`, solo lectura).
- Primera corrida en una base nueva: `--verificar` dice "Carga inicial: se registrarian N modelos y M sabores como linea base"; las siguientes solo reportan cambios.

## Costos

Todo corre en tu Mac o en la base: ningun push ni despliegue dispara builds de Vercel por esta entrega salvo el despliegue normal del codigo nuevo (1 build al integrar a main).

## Estado de las fotos web (14-nov, solo --verificar)

`fotos-web.mjs --verificar` sobre las 23 candidatas: 16 pasan la validacion (tipo, 300 px o mas, proporcion) y 7 quedan en la cola por dudosas (Adjust 40K, Dojo 40K, Elfbar 40K, Lost Mary 35K, Nexa 50K, Optimus, Waka DM 15K). Las candidatas se buscaron por texto y NO se han visto a ojo: antes de `--aplicar` abrir cada imagen (Waka Titan, Vhill y Waka DM pueden traer marca de tienda; Dojo puede traer fondo) y quitar de `fotos-web-candidatas.json` las que no sirvan. Nexa 50K y Nexa Ultra 50K, y Optimus y Waka 100, apuntan al mismo producto: decidir si comparten foto.
