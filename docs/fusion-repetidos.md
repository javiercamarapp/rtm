# Fusion de repetidos exactos (marcas, modelos y sabores)

Decision del dueno (14-nov): "marcas, modelos, sabores, todo: la palabra va en mayusculas siempre, y los nombres y sabores repetidos fusionalos en uno".
Las mayusculas son solo presentacion (ver `src/dominio/formato/nombres.ts` y `src/ui/estilos/mayusculas.css`). Esta pagina cubre la fusion.

## Que es un repetido EXACTO

Mismo nombre salvo mayusculas, espacios, guiones, signos o acentos: `catalogo.llave_exacta(nombre)` = nombre normalizado sin espacios.
`Kiwi Dragonfruit` y `Kiwi Dragon Fruit` son exactos; `Waka Blade33K` y `Waka Blade 33K` tambien.
`Lychee` y `Lychee Ice`, `Icon` e `Icon Pro`, un nombre con una letra de diferencia o un prefijo NO lo son: siguen en la cola de preguntas (`catalogo.posible_duplicado`) y nunca se unen solos.
Toda funcion de union exige la llave exacta igual, venga de una respuesta o de la regla del dueno (`regla-exactos-2026-11-14`).

## Hallazgo en produccion (solo lectura, 14-nov, proyecto kaapcbypmjclqrkwwegp)

21 marcas, 87 modelos, 128 sabores, ninguno ya unificado. Repetidos exactos:

| Tipo | Par | Estado |
|---|---|---|
| sabor | `Kiwi Dragonfruit` (id 20) -> `Kiwi Dragon Fruit` (id 76) | aprobado por el dueno, lo aplica `unificar-aprobados.mjs` |
| sabor | `Passionfruit` (id 25) -> `Passion Fruit` (id 36) | aprobado por el dueno, lo aplica `unificar-aprobados.mjs` |
| marca | ninguno | |
| modelo | ninguno | |

No hay marcas ni modelos repetidos exactos. Ademas la base ya impide los repetidos que solo difieren en mayusculas, acentos o guiones (`nombre_norm` es unico); lo que esta fusion cubre es la diferencia de ESPACIOS (`Blade33K` contra `Blade 33K`), que antes pasaba. El mecanismo queda probado (pgTAP `a13_001_fusion_repetidos`) para cuando aparezca.

## Orden de aplicacion (despues del despliegue de la migracion `20261115900000`)

1. `node scripts/catalogo/unificar-aprobados.mjs --verificar` y luego `--aplicar`: los dos pares de sabores aprobados (respaldo previo por el flujo de despliegue).
2. `node scripts/catalogo/fusionar-repetidos.mjs --verificar`: lista exacta de repetidos exactos, cual queda, plan por sku y bloqueos. Debe decir "nada pendiente" (o listar solo lo nuevo).
3. Si hay algo: resolver los bloqueos y `node scripts/catalogo/fusionar-repetidos.mjs --aplicar` (una transaccion; si algo se bloquea o la huella de lo inmutable cambia, ROLLBACK).
   Contra la base de produccion el camino sin conexion directa es `--sql-salida <archivo>` y `supabase db query --linked -f <archivo>`.

El script aplica primero marcas, luego modelos y al final sabores. Si un par de sabores es uno de los dos aprobados usa SU direccion y SU clave (`aprobados:<clave>`), asi que correr uno u otro primero no duplica la operacion. Un par de sabores que un socio ya contesto "no, son distintos" se omite.
Esta entrega NO se aplico en produccion.

## Que hace cada fusion

* Marca: los modelos de la marca origen pasan a la marca que queda (solo `catalogo.modelo.marca_id`, mutable). La origen queda `unificado_en` y libera su llave. Sin bloqueos.
* Modelo: 17 tablas apuntan a `catalogo.modelo(id)` (kardex, lotes, existencias por modelo, pedidos, compras, devoluciones, tomas, apertura, asientos, costos y tabuladores). Casi todas son inmutables o de hash encadenado y el FIFO cuenta por `modelo_id`; por eso NO se reasigna ni se reescribe ninguna fila. El modelo origen queda como historia: `unificado_en` = el que queda, sin disponibilidad, sus sku inactivos y fusionados logicamente con el sku del mismo sabor del destino (que se crea si falta), y su nombre viejo queda como alias para que las altas y el agente resuelvan al vigente. Kardex, pedidos, compras, costos de lista y tabuladores del origen no se tocan.
* Bloqueos del modelo (la unificacion no escribe nada y dice por que): existencia, reserva activa, pedido abierto, compra abierta, toma pendiente, conteo abierto, y un costo de lista o precio de cliente VIGENTE del origen que el destino no tiene (primero se fija en el destino).
* Todo es idempotente por clave, auditado (`seguridad.auditoria`), solo para socios o el canal de importacion, y reversible: `catalogo.deshacer_unificacion_catalogo(clave, id)`. Al deshacer un modelo, el sku vacio que se creo en el destino se intenta borrar; la base no lo permite porque kardex y conteos son inmutables (ni la verificacion de la llave foranea), asi que queda como una entrada de catalogo sin uso.

## Que no reaparezcan

* `catalogo.asegurar_marca` y `catalogo.asegurar_modelo` (importadores, cargador, apertura) BLOQUEAN con `P0462` un nombre repetido exacto de uno vigente y dicen con cual se confunde ("¿es lo mismo? usa X o unificalos"). El nombre viejo de uno ya unificado resuelve al vigente sin preguntar.
* `catalogo.asegurar_sabor` bloquea igual cuando lo llama el importador o el bot (canal `importacion` o `telegram`). La web y el bot de altas pasan por `alta_sabor`, que ya detecta el exacto y pregunta.
* `catalogo.escanear_duplicados_exactos()` deja una pregunta pendiente por cada repetido exacto (marca, modelo, sabor).

## Pendiente

* La web (`/catalogo`) todavia no tiene pantalla para contestar o ejecutar la union de marcas y modelos; hoy es por script. La cola web (`api.duplicados_pendientes`) lista sabores; los pares de marca no aparecen ahi.
* Las listas que no pasan por sku (resumenes de inventario por modelo) podrian mostrar un modelo unificado con 0 piezas. `api.catalogo_modelos` y `agente.catalogo_modelos` ya lo ocultan.
