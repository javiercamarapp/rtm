# Rol de bodega y pantalla Cuentas

Pedido del dueño (Javier, socio): "la persona de bodega somos nosotros por el momento; crea un tipo de cuenta de BODEGA y que desde mi perfil (socio) pueda crear tipos de cuentas a correos; que el de bodega únicamente vea los pedidos que tiene que hacer al día, de qué cliente, y qué llega de inventario para guardar y stockear".

Rama `feat/rol-bodega`. Migraciones `20261114000100_rol_bodega_cuentas.sql` y `20261114000200_bodega_lecturas.sql` (aditivas).

## Roles hoy

| Rol | Quién | Dónde entra |
| --- | --- | --- |
| `socio` | Angelo y Javier | todo el sistema; `Cuentas` es solo suya |
| `omar` | Omar (ACTIVO con vista propia: renta y disponibilidad sin costos) | `/mi-bodega` |
| `bodega` | quien dé de alta un socio | `/bodega` y `/bodega/llegadas` (solo lectura) |
| `importacion` | no es una cuenta: es el canal del importador local y del agente | ninguna pantalla |

El rol sale siempre de `seguridad.usuario`/`seguridad.correo_permitido` (nunca de `user_metadata`), y `seguridad.exigir_rol` solo reconoce cuentas ACTIVAS.

## Catálogo de tipos (extensible)

`seguridad.tipo_cuenta (rol, etiqueta, descripcion, creable_web)`. La lista de permitidos y los usuarios apuntan a él por clave foránea, así que un tipo nuevo es una fila en una migración. Solo `bodega` tiene `creable_web = true`. Un CHECK impide marcar `socio`, `omar` o `importacion` como creables desde la web (escalada de privilegios). Omar queda fuera de la web por decisión: su cuenta se activa por el flujo de M2 (`acceso:alta`), no por una pantalla.

## Cuentas (solo socio)

Pantalla `/cuentas` (sidebar, última entrada) y tres funciones `api.*`, todas con `seguridad.exigir_rol(array['socio'])` dentro, idempotentes por clave y con auditoría:

- `api.cuentas_lista()`: tipos y cuentas (correo, tipo, nombre, activa, si ya existe su acceso de Auth, último ingreso).
- `api.cuenta_alta(clave, correo, tipo, nombre)`: solo tipos creables. Un correo existente NUNCA cambia de tipo (mismo tipo = sin cambio; otro tipo = 23505). Tope de 20 cuentas activas creadas desde la web.
- `api.cuenta_cambiar_estado(clave, correo, activo, motivo)`: desactivar o reactivar sin borrar; solo cuentas de tipos administrables desde la web (nunca un socio ni Omar). Desactivar también cierra las sesiones de Auth. El acceso ya se corta solo: `exigir_rol` y la guarda de la web leen `activo` en cada llamada.

La auditoría guarda el actor, el rol, el nombre y el motivo, y una huella del correo (no el correo en claro).

## Cómo entra la persona (flujo de acceso existente)

1. El socio da de alta el correo en `/cuentas`. Eso solo agrega el correo a la lista de permitidos.
2. El enlace mágico exige que el usuario de Auth exista (`shouldCreateUser: false`) y Auth rechaza correos fuera de la lista. El usuario se crea con `npm run acceso:cuentas` (local) o `npm run acceso:cuentas:nube` (proyecto ligado): crea el usuario ya confirmado, SIN mandar correos, y no imprime correos ni llaves. La pantalla avisa cuando hay cuentas sin acceso creado. En la nube la llave de servicio se obtiene de la CLI en memoria, igual que `acceso:alta:nube`; la web nunca la tiene.
3. La persona pide su enlace en la pantalla de entrada y aterriza en `/bodega`.

Pendiente de decisión del dueño: automatizar el paso 2 desde el servidor exigiría darle la llave de servicio a la app; se dejó fuera a propósito.

## Vista de bodega

`/bodega` (Hoy a preparar) y `/bodega/llegadas`, móvil primero, claro y oscuro. Lecturas propias del rol, no tablas ni RLS amplia:

- `api.bodega_hoy_a_preparar()`: pedidos `confirmado` que salen de la bodega (el mismo criterio que "Paquetes por hacer": confirmados sin enviar, empacados o no), agrupados por cliente, con folio, estado de empaque, si vienen de días anteriores, zona (Mérida o fuera), piezas por modelo y sabor, lista de surtido total contra existencia y faltantes.
- `api.bodega_llegadas()`: compras a proveedor con destino bodega en `confirmada`, `enviada`, `en_trayecto` o `llego_merida`: proveedor, fecha esperada, guía de entrada (paquetería y número), piezas por modelo y sabor y total por guardar.

Alcance (decisión del dueño, 14-nov): bodega ve el NOMBRE del cliente y los folios (de pedido y de compra), pero NO el nombre del proveedor: `MOSTRAR_PROVEEDOR = false` en `src/dominio/bodega/bodega.ts` (el parser descarta el dato aunque la base lo entregue; la pantalla muestra "Compra" y el folio). Para volver a mostrarlo basta ponerla en `true`.

Nunca devuelven precios, montos, costos, márgenes, saldos, cuentas por pagar, teléfonos, direcciones, notas ni dueño del cliente. Además el parser de la web copia solo campos de una lista blanca. Un socio activo puede abrir la misma vista (vista previa, con aviso y regreso a Cuentas); Omar y anónimo no.

### Acciones: decisión

Solo lectura. Marcar enviado (guía y costo real, renta devengada) y recibir compra (costo puesto, diferencias, asientos) mueven dinero. La única acción sin dinero es marcar empacado, pero `operacion.marcar_empacado` exige `socio`/`importacion` y habría que reimplementarla con otro rol. Si el dueño la quiere, es el siguiente paso natural: una función `api.bodega_marcar_empacado` propia, con idempotencia y auditoría. Hoy los socios, que son la bodega, usan Paquetes por hacer con su cuenta de socio.

## Persona de bodega (`catalogo.persona_bodega`)

El dueño dice que la bodega son "nosotros" (los socios). NO se fija en producción desde este trabajo y no se cambió ningún dato real. Procedimiento recomendado cuando él lo decida:

1. Crear el cliente interno `Bodega Mérida (socios)` (tipo `credito_interno`) desde Clientes, sin precios.
2. En su ficha, "Marcar como persona de bodega" (`api.registrar_persona_bodega`; solo se puede una y es idempotente).
3. Confirmar con `select count(*) from catalogo.persona_bodega` (debe ser 1) antes del primer "Marcar enviado" y antes del lote 5 del cargador.

La renta por pieza que se devenga a esa persona es entre los socios y la sociedad: confirmar con el dueño el tratamiento contable antes de enviar pedidos reales. La semilla local del cargador (`scripts/cargador/semilla-local.sql`) ya usa ese cliente interno.

## Seguridad: qué se prueba

- pgTAP `a8_001_rol_bodega_cuentas`: alta, idempotencia, sin escalada (socio, omar, importacion), correo existente sin cambio de tipo, auditoría sin correo, correo no permitido no entra, solo socio administra, desactivar bloquea y reactivar devuelve, tope de cuentas, `has_function_privilege` (sin EXECUTE para anon ni PUBLIC).
- pgTAP `a8_002_bodega_lecturas_y_aislamiento`: contenido de las lecturas, sin llaves ni cifras de dinero; omar y anon rechazados; bodega recibe 42501 en TODA otra función `api.*` y `omar.*` (descubiertas del catálogo, con argumentos nulos), no lee tablas ni vistas de Omar, y solo las dos lecturas admiten el rol bodega.
- Nota: todos los usuarios comparten el rol de base `authenticated`; por eso el aislamiento por rol se valida dentro de cada función y se prueba con el sondeo, y `has_function_privilege` verifica que anon y PUBLIC no tengan nada.
- vitest `test/unit/rol_bodega.test.ts` y Playwright `test/e2e/bodega.spec.ts` (`playwright.bodega.config.ts`): flujo completo, REST con la sesión de bodega (403 en el resto), vista previa del socio, Omar fuera, desactivar y reactivar. Capturas en `docs/capturas/bodega/`.

## Endurecimiento (migración 20261114000300)

- El tope de 20 cuentas activas creadas desde la web se aplica también al reactivar.
- Correo validado como GoTrue: ASCII, un solo `@`, sin espacios, comas ni `<>`, sin puntos dobles ni punto final, parte local de hasta 64.
- Unicidad por forma canónica (trim, NFKC, minúsculas, sin punto final): el mismo correo con punto final o con variantes Unicode es duplicado. Limitación conocida y aceptada: no se colapsan alias `+tag` ni los puntos de Gmail (una dirección Gmail con puntos es otra cuenta, como ya exige el login).
- `seguridad.operacion.resultado` no guarda el correo (solo huella, tipo y estado). La auditoría filtra lo que parezca un correo en el motivo y el nombre; la pantalla avisa que el motivo no debe llevar correos.
- `acceso:cuentas` continúa con la siguiente cuenta si una falla (por ejemplo un 400 de Auth), reporta solo conteos y tipos, termina con código 1, y un 422 solo cuenta como "ya existía" si el usuario realmente está en `auth.users`.
- pgTAP `a8_003_cuentas_endurecimiento`; vitest en `test/unit/rol_bodega.test.ts`.

## Cambiar el correo de una cuenta (migración 20261114500100)

Decisión del dueño (14-nov): el correo de una cuenta de bodega puede ser provisional y se puede cambiar. En Cuentas, la acción «Cambiar correo» (solo socio, con confirmación) llama a `api.cuenta_cambiar_correo(clave, correo_actual, correo_nuevo, motivo)`:

- Solo tipos creables desde la web (bodega): nunca la cuenta de un socio ni la de Omar.
- Desactiva el acceso anterior (igual que Desactivar: `activo = false`, usuario inactivo y se cierran sus sesiones de Auth) y crea la cuenta con el correo nuevo del mismo tipo y nombre. La anterior se conserva para el historial.
- Mismo validador y misma forma canónica que el alta (trim, NFKC, minúsculas, sin punto final); un correo que ya tiene otra cuenta es conflicto (23505); el tope de 20 cuentas activas se respeta (el cambio es neutro: una sale, una entra).
- Idempotente: la misma clave repite el resultado; otra clave con el cambio ya hecho responde «sin cambio» y no duplica filas.
- Auditoría con la huella (16 caracteres de un hash) de los dos correos; el correo nunca queda en claro, ni en la auditoría ni en `seguridad.operacion`; el motivo pierde lo que parezca un correo.
- El usuario de Auth del correo nuevo lo crea `npm run acceso:cuentas` (o `:nube`): ese script ya atiende a toda cuenta creable activa que no tenga usuario de Auth, sin mandar correos. Hasta correrlo, la pantalla muestra «Falta crear su acceso».
- Pruebas: pgTAP `a11_002_cuenta_cambiar_correo`, vitest en `test/unit/rol_bodega.test.ts` y Playwright `test/e2e/bodega.spec.ts` (cambia el correo, la sesión anterior cae, el nuevo entra a su vista).
