# Lo que `proveedores-scraper` necesita de la base de datos

Este módulo no crea migraciones (regla 6). Trabaja contra los puertos de `src/aplicacion/proveedores/puertos.ts`; la implementación en Postgres debe respetar lo siguiente. Esquema sugerido `proveedores`, con RLS habilitada y forzada, solo socios (Omar sin acceso), funciones `SECURITY DEFINER` con `search_path=''` y `seguridad.exigir_rol(...)`.

## Tablas

- `proveedor(id, nombre UNIQUE, tipo_fuente)`.
- `proveedor_modelo(id, proveedor_id, producto_id_externo text UNIQUE, handle, titulo_original, titulo_norm, alias_titulos text[], marca, puffs int NULL, estado {activo,no_visto,descontinuado}, ausencias int, primera_ausencia timestamptz NULL, sin_sabores bool, nuevo_sin_costo bool, estado_mapeo {pendiente,auto,confirmado}, modelo_canonico_id NULL, grupos_candidatos text[], primera_vez, ultima_vez)`. Los identificadores externos son `text` o `numeric`, no `integer` (pueden pasar de 2^53).
- `proveedor_variante(id, producto_id_externo, variante_id_externo text UNIQUE, sabor_original, sabor_norm, disponible bool, estado {activa,no_vista,descontinuada}, ausencias, primera_ausencia, estado_mapeo, sabor_canonico_id NULL, cambios timestamptz[], inestable_hasta NULL, primera_vez, ultima_vez)`.
- `proveedor_candidato(clave PK, tipo, entidad_id, producto_id, valor, primera_vista, lecturas_vistas, ultima_lectura)`.
- `proveedor_cola_confirmacion(tipo {modelo,sabor}, texto_norm, texto_original, sugerencia_id NULL, similitud NULL, creada, PRIMARY KEY (tipo, texto_norm))`, más `proveedor_alias_sabor(texto_norm PK, sabor_canonico_id, confirmado_por, creado)`, `proveedor_alias_modelo(alias_norm, modelo_canonico_id)` (un alias puede tener varias filas: grupo) y `proveedor_par_descartado(tipo, texto_norm, id)`.
- `proveedor_retenida(id fijo 1, desde, veces, razon, clave, lectura jsonb)`: una sola lectura retenida a la vez; la `lectura` solo contiene ids, títulos, sabores y disponibilidad.
- `proveedor_variedad(producto_id PK, lecturas_bajas, lecturas_altas, activa, rearma_en)` y `proveedor_variedad_dia(producto_id, dia date, n int, PRIMARY KEY (producto_id, dia))` con 8 días de retención.
- `proveedor_promocion(clave PK, tipo {porcentaje,multicompra,campana}, pct int NULL CHECK (pct BETWEEN 1 AND 99), etiqueta, alcance text[], inicio NULL, fin NULL, primera_vista, ultima_vista, lecturas_ausente, estado {candidata,activa,anunciada,terminada}, aviso_por_terminar bool, coleccion NULL)`. **Ninguna columna de importe, precio, precio de comparación ni texto de mercadotecnia.** Prueba de esquema: ninguna columna del esquema se llama o termina en `precio`, `price`, `compare`, `importe`, `monto`, `costo`, `_cent`.
- `proveedor_salud(id fijo 1, ultima_lectura_ok, ultimo_intento, fallos_seguidos, bloqueada bool, incidente jsonb NULL)`.
- `proveedor_lectura(clave PK, tipo, procesada_en)` para la idempotencia (clave `fuente|fecha|hora`); los eventos llevan `UNIQUE (clave)` (cada evento tiene una clave determinista por tipo, entidad y lectura).
- `proveedor_evento(clave PK, tipo, producto_id NULL, variante_id NULL, lectura, en, antes NULL, despues NULL, datos jsonb)`. Solo los cambios, no una foto por hora.
- `proveedor_foto_diaria(dia date, variante_id_externo, disponible bool, PRIMARY KEY (dia, variante_id_externo))`; ≈ 1,003 filas al día, ≈ 366 mil al año. `guardarFotoDiaria(dia, filas)` debe ser idempotente por día (reemplaza).
- `proveedor_presupuesto(dia date PK, usadas int, por_tipo jsonb)`; la verificación del tope debe hacerse con `UPDATE ... WHERE usadas < 40 ... RETURNING` para que dos ejecuciones simultáneas no pasen de 40.

## Funciones

- `proveedores.guardar_estado(p_estado jsonb, p_eventos jsonb, p_clave_idem text) returns jsonb`: transacción única que reemplaza el estado vigente (modelos, variantes, candidatos, cola, retenida, promociones, variedad, salud, lecturas procesadas) e inserta los eventos con `ON CONFLICT (clave) DO NOTHING`. Debe rechazar (excepción) cualquier clave del JSON que parezca un importe, además de la comprobación del código.
- `proveedores.cargar_estado() returns jsonb` (STABLE) con el mismo contrato que `EstadoProveedor`.
- `proveedores.presupuesto_tomar(p_dia date, p_tipo text) returns bool`.
- Lecturas para la pantalla (STABLE): `inventario_proveedores()`, `promociones_vigentes()`, `eventos_recientes(p_limite)`, `frescura()`.

## Otros módulos

- `notificacion.emitir` idempotente por `clave_dedupe` y un `notificacion.resolver(clave_dedupe)`; tipos P-01 a P-12, P-17 a P-20 y V-1 en `notificacion.tipo` (la severidad, el destino y los textos están en `src/dominio/proveedores/avisos.ts`).
- `catalogo`: para `PuertoContextoNegocio`, un listado de modelos y sabores propios, los alias confirmados (con grupos) y la definición de "activo para los socios" (ventas en 60 días o existencia propia mayor que 0).
- Tabulador del cliente: `precioDeTabulador(clienteId, modeloCanonicoId)` devuelve el precio del cliente (nunca el costo); `existenciaPropia()` devuelve modelo y sabores con existencia, sin cifras de costo.
- `seguridad.interruptor`: `promociones_lectura` (apagado por omisión hasta la autorización del dueño) y `cron_pausado`.
- Cron en America/Merida: `0 * * * *` para la lectura horaria, `0 */3 * * *` para promociones, semanal para robots; la confirmación a los 10 minutos se programa con el instante que devuelve la lectura. Sin builds de Vercel.
