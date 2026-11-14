# Cargador de asientos y pedidos historicos

Lleva al sistema los asientos y los pedidos reales del dueno y comprueba el CUADRO completo. Es codigo generico: LEE archivos privados por ruta (`--archivos`) y nunca guarda, imprime ni versiona un dato real. En el repo solo hay datos sinteticos (`test/fixtures/cargador`). Las cifras objetivo tambien viven en un archivo privado.

Rama `feat/cargador`. Esta rama NO carga nada a produccion ni a ninguna base de la nube: se probo solo contra una base local propia.

## Ruta de carga elegida y por que

Decision: cada paso es UNA transaccion que llama funciones EXISTENTES del sistema (`api.*` u `operacion.*`) desde SQL, con la identidad de un socio (`request.jwt.claim.sub`), igual que las pruebas pgTAP. Nada de INSERT directos a tablas de negocio (una prueba de vitest lo vigila).

| Opcion | Resultado |
|---|---|
| INSERT directos a las tablas | Descartada: se saltaria los triggers de solo insercion, la partida doble diferida, la idempotencia y las reglas (minimos, avisos, costo del surtido). |
| Sesion de servicio por PostgREST (`authenticated` con JWT) | Descartada: exige fabricar un JWT de socio (secreto) y el rol `authenticated` no tiene `execute` sobre `catalogo.*` ni `operacion.*` (altas de catalogo, pagos con fecha pasada, bajas). |
| El agente de Telegram | Descartada: el agente no captura capital ni destinatarios, y su canal avisaria al grupo de los socios. |
| SQL con la identidad de un socio, conexion del rol propietario | Elegida: usa las mismas funciones que la web, deja el actor en la auditoria, cada llamada valida el rol dentro (`exigir_rol`), y cada operacion es idempotente por su clave. |

El actor es Javier por omision (`--actor`). Los pedidos a costo del socio de menudeo y sus pagos exigen su propia identidad (Angelo): el cargador los ejecuta como el. El capital que declara un socio se carga con la identidad del actor y la nota lo dice (confirmacion del socio pendiente).

### Funciones que usa (todas existentes)

Catalogo: `catalogo.asegurar_modelo`, `asegurar_sku`, `fijar_costo`, `asegurar_cliente`. Capital y pagos: `api.pago_proveedor_de_socio` (declara capital). Compras: `api.crear_compra`, `confirmar_compra`, `recibir_compra`. Pedidos: `api.ds_crear_pedido`, `ds_capturar_destinatario`, `ds_capturar_costo`, `crear_pedido`, `confirmar_pedido`, `enviar_pedido`. Cobros: `api.ds_pagar_proveedor` (cliente a la cuenta del proveedor), `ds_pagar_pedido_menudeo` (pedido a costo del socio), `registrar_pago` (cobro en la cuenta de un socio o de un proveedor para ventas de inventario). Baja de piezas regaladas: `operacion.registrar_movimiento` (merma).

### Migracion nueva (una, aditiva)

`20261113600000_negocio_hoy_fecha_de_carga.sql`: `create or replace function negocio.hoy()`. Varias funciones fechan sus eventos con `negocio.hoy()` y no reciben fecha (confirmar pedido o compra, capturar costo). Sin esto, una carga historica dejaba esos eventos en el dia de la carga (una compra quedaba "confirmada" despues de recibida). Con la variable transaccional `rtm.fecha_negocio`, `negocio.hoy()` devuelve esa fecha. Garantias: sin la variable el comportamiento es identico; solo se respeta con `session_user = postgres` (la web entra como `authenticator`); nunca una fecha futura; un texto que no sea AAAA-MM-DD se ignora. Sin DROP, sin GRANT. pgTAP: `a6_001_negocio_hoy_fecha_de_carga.test.sql`.

No hizo falta ninguna otra funcion: el cobro con fecha pasada (`p_fecha`), "mercancia pedida por recibir" (orden de compra confirmada y sin recibir: mercancia en transito 1320 contra la cuenta del proveedor), la baja de piezas regaladas (merma) y el alta de inventario (compra recibida) ya existian. Lista de GRANT nuevos: ninguno.

### Clientes unificados y casi duplicados

El alias `clientes` (`{"<nombre en la fuente>": "<nombre unico>"}`) une dos escrituras del mismo cliente y `nombres` fija el nombre visible; la clave de identidad de cada documento no cambia. Al normalizar, el cargador avisa (sin nombres, solo los documentos donde aparecen) de clientes con nombre casi igual (tokens contenidos o distancia de edicion de 2 o menos) para que el dueno confirme si son el mismo.

## Archivos de entrada (carpeta privada, permisos 700)

| Archivo | Contenido |
|---|---|
| `asientos.json` | Asientos del PDF (pedidos de Karen, cobros, capital, compra de inventario, ventas de inventario, obsequio). |
| `pedidos-isaac.json` | Pedidos con Isaac numerados 1 a N. |
| `alias-modelos.json` | Opcional. `modelos`: texto normalizado a `{marca, modelo, puffs}`; clave `asientos:<texto>` o `isaac:<texto>` si el mismo texto significa dos modelos; `costos`: `{"Isaac|<modelo>": pesos}` para fijar el costo de catalogo cuando dos pedidos difieren. |
| `objetivo.json` | Cifras objetivo en centavos para `cuadre.mjs` (formato en la cabecera de `cuadre.mjs`). |

## Reglas aplicadas (confirmadas por el dueno)

- Un solo negocio; todo parte de cero. Participacion 50/50. Utilidad = venta menos TODO el costo (producto, envio, costos directos).
- Fechas: cada abono con su fecha real; un pedido toma la fecha de su primer abono si es anterior (un pedido no puede ser posterior a su abono); lo demas sin fecha, 2026-11-12. Ventas a credito: fecha de pago explicita, la de otro pedido del mismo cliente o, por omision, 2026-11-20.
- Capital solo si el socio lo declara (pagos de socio a proveedor con `declara_capital`); lo demas es reembolso. El capital de un socio cargado por otro actor queda anotado como pendiente de su confirmacion.
- Cobros de clientes: directo a la cuenta del proveedor (el pedido queda amortizado) o a la cuenta de un socio (fondos de la sociedad en su poder, activo "pendiente de entregar").
- Pedido a costo del socio de menudeo: ingreso igual al costo, utilidad cero, no resta a la aportacion neta, queda pendiente de pago.
- Interes de credito simple; un interes pactado se carga como monto fijo (recargo del pedido) y es ingreso 50/50.
- Compra de inventario: costo puesto = producto + envio capitalizado, por pieza recibida; lo pagado de mas respecto de lo recibido queda a favor en la cuenta del proveedor (faltantes descontados). Mercancia pedida por recibir: orden confirmada, NO inventario hasta recibirla.
- Piezas regaladas: baja a costo promedio como merma; el sabor pendiente se asigna al sabor con mas existencia (`--sabor-obsequio` lo fija) y debe confirmarse con un conteo.

### Precios y costos por renglon (el proveedor no desglosa)

La fuente da totales por pedido, no por renglon. Se reparte cada total en centavos por pieza ENTEROS con `repartirExacto` (suma exacta, residuo de 1 a 4 centavos por pieza en algunos renglones; si el total no es alcanzable con esas cantidades, el renglon mas grande se parte en dos del mismo SKU). El costo real por renglon se captura con `ds_capturar_costo` (motivo: carga historica) cuando difiere del de catalogo; el costo de catalogo de Karen es un SUPUESTO (promedio por pieza del pedido) marcado como tal. Esas capturas aparecen en el registro de diferencias con el proveedor: no son disputas, son el costo real del estado de cuenta.

## Idempotencia, lotes y reanudacion

- Cada operacion usa una clave `carga:<hash corto de la clave de identidad>:<paso>`. La clave de identidad es `proveedor|folio externo|cliente|fecha|consecutivo` (ya calculada en las fuentes). La clave no lleva datos personales.
- Una segunda corrida devuelve el resultado guardado de cada operacion y no cambia nada (`0 pasos aplicados`). Si se reutiliza una clave con otro contenido, el sistema rechaza (`conflicto de idempotencia`): nunca duplica ni pisa.
- Un paso (por ejemplo un pedido con su costo, destinatario, envio y cobros) es UNA transaccion; ademas fuerza las comprobaciones diferidas del libro: si el libro no cuadra, el paso falla y no queda nada.
- Lotes: 1 catalogo y clientes; 2 capital, compra de inventario y mercancia por recibir; 3 pedidos de Karen y sus cobros; 4 pedidos con Isaac y sus cobros; 5 ventas de inventario, cobros y obsequio. `--lote N` corre solo ese lote y exige que los anteriores ya esten cargados; `--hasta-lote N` corre del 1 al N. Interrumpir y volver a correr completa lo que falte.
- El destinatario es un paso aparte y opcional (`--con-destinatarios`, exige `DS_LLAVE_DESTINATARIO`): correr con o sin la bandera no cambia la clave del pedido. Sin la bandera no entra ningun dato personal de destinatarios a la base. Los destinatarios incompletos se avisan sin imprimirlos.

## Cuadre (`cuadre.mjs`, solo lectura)

Via 1 (libro): `operacion.cuadre_socios` (Libro conciliado), comprobaciones C1 a C24 y CU1 a CU3, balance (activo = pasivo + capital contable + utilidad), estado de resultados y capital por mes. Via 2 (auxiliares): saldos por pedido, posicion con cada proveedor, kardex, cuentas de los socios y renta devengada. Ademas compara contra las cifras objetivo del archivo privado y marca cada diferencia como `igual`, `explicada` (con su causa) o `DIFERENCIA`.

### Diferencias conocidas entre el mapeo y el sistema (con su causa)

1. Renta de bodega: es REGLA ACORDADA del negocio (2 pesos por pieza enviada desde la bodega, a favor de Omar) y se devenga. Baja la utilidad y sube el pasivo con Omar lo mismo; el activo total no cambia. Las cifras objetivo ya la incluyen (utilidad, valuaciones personales, pasivo, y su propia linea de renta devengada), asi que el cuadre las da por buenas.
2. Redondeo del costo promedio movil (unos centavos, documentado): el kardex fija el valor por pieza en centavos; difiere unos centavos del costo puesto exacto del mapeo en el inventario, el activo total y la utilidad.
3. Cuentas por cobrar a clientes: el libro (cuenta 1210) incluye el pedido a costo del socio, pendiente de pago; el mapeo lo muestra aparte. La suma coincide.
4. Utilidad reinvertida y anticipo con Karen: el sistema cuenta como reinvertida solo la de pedidos de dropshipping depositados en su cuenta (el excedente por encima del costo, topado por la utilidad) y como anticipo solo cuando la posicion neta con el proveedor es a favor; el mapeo clasifica ademas la utilidad de una venta de inventario cobrada a Karen y el capital depositado. No cambia ninguna cifra del cuadre: es clasificacion.

## Supuestos del mapeo que el dueno debe confirmar

- Modelos: el modelo "50K" de las ventas de inventario y de la compra se cargo como el modelo economico (costo menor) y el "50K" del pedido de dropshipping con costo mayor como otro modelo; son dos productos distintos con el mismo nombre en la fuente.
- El pedido parcialmente pagado toma la fecha de su primer abono.
- Los faltantes de la compra de inventario se reflejan como saldo a favor con el proveedor (la compra se cargo por lo recibido); el sistema no los muestra como una diferencia de recepcion.
- La disputa con Karen por un pedido no se registra como pasivo: el pedido se carga al costo correcto y la diferencia queda anotada.
- Los obsequios sin sabor se asignaron a un sabor provisional.
- El envio de la mercancia pedida por recibir esta pendiente: no se carga; al llegar se capitaliza al costo con una recepcion y un ajuste de la compra.

## Hallazgos del sistema (no del cargador)

- Cada evento carga avisos (paquete enviado, orden confirmada, pedido enviado aceptando avisos). Con `telegram_envio` o `correo_envio` encendidos se enviarian decenas de mensajes al grupo: el cargador exige esos interruptores apagados (prerrequisito verificado en solo lectura).
- Los pedidos se envian "aceptando avisos" (no hay tabulador de precios para estos clientes): quedan avisos abiertos por pedido. Se limpian en la pantalla de avisos o se resuelven al fijar precios.
- El chip "Por pagar a Isaac" (Inicio y barra) mostraba solo la cuenta corriente; la migracion `20261113600100` lo cambia a la posicion completa del Mayor (2110), la misma de Proveedores ("Falta por saldar") y Capital por socio, con su ayuda y su cifra explicable (`conta:saldo:2110`).

## Persona de bodega (la elige el dueno)

Las ventas de inventario de Merida (lote 5) exigen una persona de bodega configurada: el cliente que presta la bodega. El cargador NO la decide. Si falta en el destino, carga los lotes 1 a 4 y se detiene antes del lote 5 con un mensaje claro (la verificacion de solo lectura la marca como AVISO). Para configurarla: en la web, Clientes, ficha del cliente elegido por el dueno, "Marcar como persona de bodega" (`api.registrar_persona_bodega`; solo se puede una). Despues, `--lote 5`. En una base local de prueba, `semilla-local.sql` crea una persona sintetica.

## Procedimiento de produccion

Script: `sh scripts/cargador/produccion.sh <paso>` (sin secretos; lo corre el dueno con `!`). Pasos:

1. `1-verificar`: ensayo sin escribir. Plan, prerrequisitos (migracion aplicada, interruptores apagados, socios activos, proveedores, persona de bodega, 0 pedidos y 0 asientos) y estado de la base: solo lectura (transaccion `read only`).
2. `2-respaldo`: respaldo cifrado previo con el flujo existente (`npm run respaldo -- previo-a-carga`). Descifrarlo de prueba antes de seguir.
3. `3-cargar <lote>`: lotes 1 a 5 en orden, cada uno con confirmacion escrita.
4. `4-conteos`: pedidos, compras, pagos, pagos de socios y mermas esperados contra los de la base; sin operaciones a medias.
5. `5-cuadre`: libro conciliado, C1 a C24 y CU1 a CU3 sin rojas, balance, y comparacion con el objetivo con cada diferencia explicada.
6. `6-idempotencia`: segunda corrida completa: `0 pasos aplicados`.
7. `reversa`: restaurar el respaldo previo (`docs/DESPLIEGUE.md`, Respaldos y restauracion). Los hechos son de solo insercion: no se borran. Un error descubierto despues de operar se corrige con las funciones del sistema (anular, ajuste de proveedor, asiento manual con motivo), no restaurando.

Prerrequisito de despliegue: las migraciones `20261113600000` (fecha de carga) y `20261113600100` (Por pagar a Isaac con la posicion completa del Mayor; lecturas, sin DROP ni GRANT nuevo) deben estar aplicadas en produccion antes de cargar; aplicarla es el flujo de despliegue autorizado del dueno (puede provocar un build: decirlo antes). El cargador se niega a escribir si no esta.

Costos: la carga no toca Vercel ni GitHub; su unico efecto externo es la base de produccion. Builds provocados por esta rama: 0.

## Pruebas

- `test/unit/cargador/*.test.ts` (vitest): dinero en centavos, prorrateo exacto (pruebas con semilla), normalizacion, fechas y creditos, plan, y la guarda de que ningun script del cargador escribe con INSERT, UPDATE o DELETE y de que el cuadre es de solo lectura.
- `supabase/tests/database/a6_001_negocio_hoy_fecha_de_carga.test.sql` (pgTAP).
- `npm run cargador:prueba`: de extremo a extremo con datos sinteticos sobre una base local recien reseteada con `scripts/cargador/semilla-local.sql` (carga, segunda corrida sin cambios, lote suelto sin cambios, cuadre).
- Base local propia: `project_id` y puertos distintos (`supabase/config.toml` fuera de commits con `skip-worktree`).

## Correccion de precios por modelo de pedidos enviados (14-nov)

Despues del despliegue de la migracion `20261115400000` (que no provoca builds de Vercel: se compila en local y se sube prebuilt): `node scripts/cargador/corregir-precios-por-modelo.mjs --datos <JSON privado> --verificar` (solo lectura) y luego `--aplicar` (solo la funcion oficial `operacion.corregir_precio_por_modelo`, una transaccion por pedido, idempotente). Los datos reales van en un archivo privado fuera del repo; formato, ejemplo ficticio y detalle en `docs/correccion-precios-por-modelo.md`.
