# Alias Waka unidos con su modelo por puffs, y carga del tabulador de precios

Decision del dueno (14-nov): "Si, unir cada alias con su modelo por pufs" y "Optimus 100K y SoPro 15K". Nada de esto se aplico en produccion: son scripts con `--verificar` de solo lectura y una migracion aditiva.

## 1. Union de alias Waka

Diccionario: `scripts/catalogo/alias-waka.json` (alias, `tambien` = nombres sueltos del mismo producto, destino). Icon = 50K, Steel = 60K, SoPro = 15K, Smash Go = Waka Go = 10K, PA30000 = 30K, Elite = 40K, Burst = 36K, Blade = 33K, Optimus = 100K (corregido: no 80K), Slim = 12K, Jupiter = 50K Jupiter, Icon Slim = 20K.

### Migracion `20261118100000_unificar_alias_waka.sql` (aditiva, reversible)
- `catalogo.unificacion_modelo_aprobada`: los pares aprobados por el dueno (regla `alias-waka-2026-11-14`). RLS forzada, sin acceso directo.
- `catalogo.aprobacion_exacta` (misma funcion de la fusion de repetidos) con una rama mas: un par de esa tabla se acepta aunque los nombres no sean repetidos exactos. Todo lo demas sigue exigiendo el nombre exacto o la respuesta de un socio.
- Alias nuevos `semilla alias-waka 2026-11-14 v2` (solo los que empiezan con "Waka"; los nombres sueltos se vuelven alias al unir el modelo) y correccion de `waka sopro` hacia Waka 15K (la nota guarda el modelo anterior).
- Reversa de alias: ver el encabezado de la migracion. Reversa de una union: `catalogo.deshacer_unificacion_catalogo` (como las demas).

### Script `scripts/catalogo/unificar-alias-waka.mjs`
```
export RTM_DB_URL=<cadena de produccion>      # del gestor de secretos; nunca en el repo ni en pantalla
node scripts/catalogo/unificar-alias-waka.mjs --verificar
node scripts/catalogo/unificar-alias-waka.mjs --aplicar [--omitir-bloqueados]
node scripts/catalogo/unificar-alias-waka.mjs --sql-salida <archivo>     # para `supabase db query --linked -f`
```
- `--verificar` (transaccion `read only`): por par origen -> destino, sku que se fusionan o se crean en el destino, existencias a combinar por sabor, pedidos, renglones, notas y compras que cuelgan del origen, precios y costos que se heredan, y BLOQUEOS. Sale con 1 si hay alguno.
- `--aplicar`: UNA transaccion. Primero hereda al destino los precios de cliente y costos vigentes que le faltan (con `catalogo.fijar_precio` y `fijar_costo`; es lo que la union pide antes de proceder), luego `catalogo.unificar_modelo`. Compara la huella (kardex, existencias, eventos, asientos, cadena del libro, cuenta 1310, comprobaciones C1..C24) y hace ROLLBACK si cambia o si algo se bloquea. Idempotente (segunda corrida: "ya estaba unido"). Nunca modifica tablas inmutables: el origen queda como historia (`unificado_en`), sus sku se fusionan logicamente y su nombre viejo queda como alias.
- Si el modelo destino NO existe, el par queda BLOQUEADO con la explicacion (renombrar o atar a mano). El script nunca crea modelos ni duplicados. Un origen que no existe como modelo (solo alias) se salta.
- Si dos alias del mismo destino traen un precio o costo distinto, el segundo se bloquea hasta que el dueno diga cual vale.
- Limite conocido: la fila de la cola `posible_duplicado` que deja la union de modelos dice "mismo nombre salvo mayusculas..." (texto de la fusion de exactos); la aprobacion real queda en `unificacion_catalogo.aprobacion` (`alias:alias-waka-2026-11-14`).

### Orden
1. Desplegar la migracion por el flujo oficial. 2. `--verificar`. 3. Resolver bloqueos. 4. `--aplicar`. 5. `--verificar` otra vez (todo "ya estaba unido").

### Casos que el dueno debe mirar
Hay modelos por puffs duplicados que el diccionario no ordena unir: por ejemplo `Waka 50K` y `Waka Icon 50K`, `Waka 36K` y `Waka Burst 36K`, `Waka 15K` y `Waka DM 15K`, `Waka Sopro 30K` frente a `Waka 30K`. Los destinos son los del diccionario (nombre exacto por puffs); si el dueno prefiere otro destino se cambia `destino` en el JSON y la migracion (tabla de aprobados) antes de aplicar.

## 2. Carga del tabulador de precios

Hoy hay combinaciones cliente x modelo con renglones vendidos y sin precio de lista (`catalogo.tabulador_precio`): salen los avisos `sin_precio_catalogo` (NT-004) y "Pedido enviado aceptando avisos".

`scripts/catalogo/cargar-tabulador.mjs`:
```
node scripts/catalogo/cargar-tabulador.mjs --desde-precios-usados [--salida <json fuera del repo>]
node scripts/catalogo/cargar-tabulador.mjs --datos <json privado> --verificar
node scripts/catalogo/cargar-tabulador.mjs --datos <json privado> --aplicar [--reemplazar]
```
- `--desde-precios-usados` (solo lectura) propone el precio de lista tomando el precio realmente cobrado cuando es unico y redondo (multiplo de 50 centavos). Es AMBIGUO si hubo mas de un precio o un precio con centavos raros (prorrateo). Agrupa por MODELO VIGENTE: un origen ya unido cuenta en su destino. Ejecutalo despues de unificar los alias.
- El JSON privado (pesos) vive en `~/.bodega-secrets` o en el scratchpad, nunca versionado: `[{ "cliente", "modelo", "precio_pesos", "vigente_desde"?, "nota"? }]`. Ejemplo ficticio en las pruebas.
- `--aplicar`: usa solo `catalogo.fijar_precio`, una transaccion, huella de lo inmutable, idempotente; no pisa un precio vigente distinto (lo reporta como CHOQUE; `--reemplazar` lo cierra y abre el nuevo). Origen `lista_javier` (el check de la tabla solo admite documento, chat o lista_javier) y nota `carga historica 2026-11-14`. No toca pedidos ni notas.

### Como se resuelven los avisos existentes (hallazgo importante)
El aviso `sin_precio_catalogo` se evalua contra `pedido_linea.precio_tabulador_cent` (foto tomada al crear el renglon) y esa linea enviada es inmutable. Por eso cargar el tabulador evita el aviso en pedidos NUEVOS pero NO cierra solo los viejos. Los avisos existentes se resuelven asi:
1. Pedido ya cobrado por completo: `notificacion.depurar` lo cierra (regla `aviso_excepcion_cierra_al_cobrar`). Correr `node scripts/notificaciones/resolver-vigentes.mjs --verificar` y luego `--aplicar`.
2. Pedido aun por cobrar: la foto del renglon solo cambia con una correccion de precio (`api.corregir_precio_por_modelo`, docs/correccion-precios-por-modelo.md), que fija `precio_tabulador_cent` al tabulador vigente del cliente. Esa funcion responde `sin_cambio` si los precios ya son los pedidos, asi que para solo refrescar la foto haria falta una extension (no incluida: no se invento).
3. Despues de cargar el tabulador, los pedidos nuevos que cumplan su precio ya no generan el aviso.
