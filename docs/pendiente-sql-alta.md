# SQL pendiente para las pantallas de alta (clientes, precios, costos)

Estado: las pantallas ya existen y hablan con un adaptador (`src/infra/supabase/lector-catalogo.ts`, `altaCatalogoSupabase`). Las funciones de abajo NO existen todavía en el esquema `api`. Mientras no se instalen, cada pantalla muestra «Esta función todavía no está instalada en la base» (código `NO_INSTALADA`, detectado con PGRST202 o 42883) y no pierde lo capturado. Las pruebas usan un puerto simulado.

Hoy el esquema `catalogo` ya tiene la lógica (`asegurar_cliente`, `fijar_precio`, `fijar_costo`), pero ninguna está expuesta en `api` ni es ejecutable por `authenticated` (`revoke execute on all functions in schema catalogo`). Solo `api.fijar_disponibilidad` escribe hoy. El patrón a seguir es el de `20261110000600_api_escritura.sql`: `security definer`, `set search_path = ''`, `seguridad.exigir_rol(array['socio'])`, resolver ids a nombres y llamar a la función de `catalogo`, `revoke ... from public, anon` y `grant ... to authenticated`.

Todas reciben `p_clave_idem text` con la forma `web:<uuid>` (la web ya la manda) y son idempotentes con `seguridad.iniciar_operacion` / `terminar_operacion`. Todo monto viaja en centavos enteros (`bigint`).

## 1. api.crear_cliente

```sql
api.crear_cliente(p_clave_idem text, p_nombre text, p_tipo text, p_nota text) returns jsonb
-- { "cliente_id": 12, "creado": true }   creado=false si ya existía el nombre normalizado (no se duplica)
```

- `p_tipo` in ('mayoreo','credito_interno','ocasional').
- La web NO manda dueño (decisión del dueño: la interfaz no divide por Angelo y Javier). `catalogo.cliente.duenio_id` es `not null`: la función debe asignar un valor interno por omisión (por ejemplo un dueño fijo configurable en `catalogo.config`) o la columna debe volverse anulable. Decisión pendiente del dueño.
- Debe reutilizar `catalogo.asegurar_cliente` (que ya guarda `nota`).
- Errores esperados: 22023 (tipo inválido), 42501 (sin rol socio).

## 2. api.editar_cliente

```sql
api.editar_cliente(p_clave_idem text, p_cliente_id bigint, p_nombre text, p_tipo text, p_nota text, p_activo boolean) returns jsonb
-- { "cliente_id": 12 }
```

- Cambia nombre canónico, tipo, nota y `activo`. Desactivar no borra precios ni historial.
- Error 23505 si el nombre normalizado choca con otro cliente. 22023 si el cliente no existe.
- No se guardan teléfonos ni direcciones (regla del proyecto).

## 3. api.fijar_precio

```sql
api.fijar_precio(p_clave_idem text, p_cliente_id bigint, p_modelo_id bigint, p_precio_cent bigint,
                 p_desde date, p_origen text, p_nota text) returns jsonb
-- { "precio_id": 5, "sin_cambio": false }
```

- Envoltura de `catalogo.fijar_precio` (resuelve `nombre_canonico` del cliente y del modelo). Ya cierra la fila abierta el día en que empieza la nueva y rechaza vigencia retroactiva con `P0422`.
- La web manda siempre `p_origen = 'chat'` (indicación de un socio; es un valor permitido por el `check` de `tabulador_precio`).
- `p_nota` (motivo del cambio) queda en `tabulador_precio.nota` y se ve en el historial.
- La web ya valida: precio > 0 y ≤ 100,000.00, fecha válida y posterior a la vigente, motivo cuando hay precio vigente. La base sigue siendo la autoridad.

## 4. api.fijar_costo

```sql
api.fijar_costo(p_clave_idem text, p_proveedor text, p_modelo_id bigint, p_costo_cent bigint, p_desde date,
                p_fuente text, p_motivo text, p_supuesto boolean, p_es_lista boolean) returns jsonb
-- { "costo_id": 6, "sin_cambio": false }
```

- Envoltura de `catalogo.fijar_costo`. `p_proveedor` in ('Isaac','Karen'). Si `p_es_lista = false`, `p_motivo` es obligatorio (lo exige el `check` de la tabla).

## 5. api.costo_historial (lectura)

```sql
api.costo_historial(p_modelo_id bigint) returns jsonb
-- [ { "proveedor": "Isaac", "costo_cent": 9500, "desde": "2026-11-01", "hasta": null,
--     "fuente": "lista de Isaac", "es_lista": true, "motivo": null, "supuesto": false, "vigente": true }, ... ]
```

- Todas las filas de `catalogo.costo_proveedor` del modelo, de la más reciente a la más antigua. Hoy `api.catalogo_modelos` solo trae el costo vigente.
- Sin esta función la pantalla `/catalogo/costos` sigue funcionando y avisa «Historial no disponible todavía».

## 6. Cifras para «Explicar este número» (`api.explicar_cifra` y la lista blanca de `src/app/(socio)/acciones.ts`)

- `costo:(Isaac|Karen):<modelo_id>`: costo vigente con sus vigencias y fuente (renglones). Hoy los costos solo se pueden explicar a través del margen de un cliente (`margen:<cliente>:<modelo>`).
- `existencia:total`: total de piezas en bodega para el chip «En bodega» del pulso. Hoy el chip muestra la suma real pero enlaza al inventario, donde cada modelo sí se explica.

Al instalar cualquiera de estas, hay que agregar el patrón a la expresión regular de `explicarCifra` y cambiar el chip / la tabla para usar `CifraComprobada`.

## 7. Pruebas pgTAP sugeridas

Idempotencia con la misma clave, vigencia retroactiva (P0422), cliente repetido (`creado=false`), motivo obligatorio con `p_es_lista=false`, rol sin permiso (42501) y que `anon` no pueda ejecutarlas.
