# Informe de la fase F2

Fecha: 10-nov-2026. Alcance: compras con cuenta del proveedor, pedidos surtidos pieza por pieza con nota y PDF, pagos y cuentas por cobrar, paquetes, el modelo de Omar por funciones y el núcleo de avisos. Todo local: sin remoto, sin push, sin Vercel, sin cuentas de pago, sin proyectos en la nube. **No se cargó ningún dato real de ventas, compras ni pagos**: pruebas, capturas y demostración usan fixtures ilustrativos y los casos dorados.

## Lo que se hizo

1. **Compras (0007, 0008).** Orden de compra a Isaac o Karen (alias Vapemate) con renglones por modelo y sabor, costo vigente (motivo obligatorio si no es el de lista, también como CHECK), guía y seguro, estados `borrador, confirmada, enviada, en_trayecto, llego_merida, recibida, cerrada, anulada`. Confirmar aplica el dinero a la **cuenta con el proveedor** (positivo = a favor, negativo = se debe, con palabra en pantalla): Karen exige saldo suficiente (error `P0424`), Isaac admite crédito. Pagos de cliente redirigidos a un proveedor y pagos de un socio con su cuenta de origen. Tres cantidades por línea (pagadas, facturadas, recibidas). La recepción se confirma por sabor y **suma al inventario solo entonces**, por lo recibido y con el costo puesto de lo facturado (guía y seguro prorrateados con residuo exacto). La diferencia va a la cuenta puente y se asigna a la sociedad, a un socio o al proveedor; asignar, reasignar y cancelar son renglones aparte.
2. **Pedidos y notas (0010, 0011).** Pedido por modelo y sabor con precio del tabulador; avisos que no bloquean (precio distinto, venta a costo, sin precio, menos de 20 piezas, existencia insuficiente) y "Enviar de todos modos" que registra quién; folio `P-0001` consecutivo sin huecos; confirmar solo reserva; **marcar enviado** surte pieza por pieza, descuenta, devenga la renta, emite la nota v1 inmutable y aplica el saldo a favor del cliente; lo no surtido queda como entrega diferida o pieza que no llegó. Nota tipo invoice (formal, sin color, solo nombre del cliente, sabores por modelo con subtotales), texto de WhatsApp, hoja interna con cascada, utilidad por modelo y por pedido y comprobaciones C1 y C2, correcciones enlazadas `P-0001-C1`, anulación por contramovimiento.
3. **Motor de PDF** (`src/infra/pdf/nota.ts`): Carta, una sola tinta, Figtree y EB Garamond incrustadas, bytes idénticos (mismo sha256) al generarlo dos veces; se guarda una vez en `nota_documento` y reabrir entrega los mismos bytes.
4. **Pagos y cuentas por cobrar (0009).** Pagos con destino (Angelo, Javier, Isaac, Karen, efectivo), sin identificar (no se aplica; se identifica después), comprobante repetido = aviso y no se registra, anticipos destinados a un pedido, aplicación del más antiguo, saldo a favor. El dinero que cae en la cuenta de un socio es **deuda del socio con la sociedad**; baja al entregarlo, al pagar a un proveedor con él o al traspasarlo. Página Cuentas por cobrar con plazo, vencimiento, abonos, saldo, antigüedad y "Explicar este número".
5. **Paquetes.** *Por hacer*: lista de surtido por modelo y sabor contra existencia (avisa si falta un sabor), empacar, enviar con guía y costo real. *En trayecto*: órdenes confirmadas con guías (varias), días en camino, llegó a Mérida, confirmar recepción. No hay aviso a Omar.
6. **Omar por funciones (0012).** Renta de $2 por pieza devengada al marcar enviado; tomas a crédito (nacen autorizadas si las registra un socio, `pendiente` con reserva si las pide Omar), autorizar, rechazar, caducar, deshacer; liquidación semanal con corte el lunes; pagos de y a Omar. Casos G6: 300 pz × $2 contra 4 × $150 = saldo cero; 220 × $2 contra 4 × $175 = −$260.00; 428 × $2 contra 4 × $150 = +$256.00. Sin interfaz.
7. **Núcleo de avisos.** Tabla `operacion.aviso`, `avisar()` idempotente dentro de la transacción del hecho, resolución automática, lectura por usuario, eco propio, página `/avisos` (solo software). Emisores de F2: NT-006, 007, 008, 010, 012 a 017, 037, 038, 051 y los avisos del pedido (NT-001, 002, 004, 005). `operacion.evento.canal` y `seguridad.canal_actual()` admiten `sistema` (probado).
8. **Casos dorados con cifras de los documentos** (pgTAP): OC de 22,000 con saldo de 30,500 deja 8,500; OC de 40,000 deja −9,500 en Isaac y no se confirma con Karen; recepción de 1,524 de 1,536 suma 1,524, inventario $139,516.45, 12 piezas = $1,098.55 a la cuenta puente, asignadas a Angelo (puente a cero, deuda $1,098.55, Angelo paga y queda en cero, reasignación al proveedor cancela la deuda y crea el reclamo); los $1,440 quedan en `partida_fuera_sociedad` aparte; pedido de 50 donde salen 40 cobra solo 40; pago de $9,000 a la cuenta de Angelo baja la CxC y Angelo debe $9,000; paga $9,000 a Isaac y su deuda queda en cero; el mismo mensaje dos veces se aplica una vez. Además la nota de Villa ($13,590.00, 62 piezas, texto exacto) y la renta de $124.00 con origen bodega y $0 en directo.

## Cómo se verificó

```
OK     Tipos (tsc) (0.9 s)
OK     Lint y fronteras entre capas (eslint) (1.1 s)
OK     Guardas estaticas de diseno y dominio (0.0 s)
OK     Escaner de secretos y correos (0.7 s)
OK     Pruebas unitarias y de contratos (vitest) (1.4 s)                 186 pruebas en 22 archivos
OK     Entorno local (.env.local y rol servidor) (1.3 s)
OK     Pruebas de base de datos (pgTAP) (1.7 s)                          357 afirmaciones en 10 archivos
OK     Importador: idempotencia con fixtures (1.5 s)
OK     Importador sobre las fuentes reales (43 costos, 19 clientes, 179 lineas, 12 en cero, 17 de Karen) (0.3 s)
OK     Reinicio de la base local (12.9 s)
OK     Entorno local tras el reinicio (1.1 s)
OK     Pruebas de pantallas y acceso (Playwright) (168.5 s)              57 pasadas
VERIFICAR: OK (12 pasos, 210.5 s)
```

Playwright: laptop 1440 (acceso, F1, F2), iPhone 16 Pro (WebKit 402x874), plegable cerrado (344) y abierto (880) en Chromium móvil: sin scroll horizontal, objetivos de 44 px, campos de 16 px, el diálogo de enviado cabe en pantalla y el plegado en vivo no pierde lo escrito. Capturas: 160 en `docs/capturas/f2/` (Chromium y WebKit, claro y oscuro, 1440x900 y 402x874) con `manifest.md`; se regeneran con `npm run capturas:f2`.

## Defectos encontrados y corregidos en el camino (también de F0 y F1)

- **PostgREST no fija `request.jwt.claim.sub`**: el actor de los eventos de F1 quedaba nulo al escribir desde la web. Ahora todo usa `auth.uid()`.
- **pg_safeupdate** (extensión del rol de la API) rechaza `DELETE` sin `WHERE`: afectaba a `cerrar_conteo` de F1 y a funciones nuevas; pgTAP no lo ve porque corre como postgres. Se corrigieron y se agregó una prueba de contrato que recorre las migraciones.
- La lista de rutas permitidas para `next` no incluía las rutas nuevas.
- Las pruebas de pantallas dejan hechos que no se pueden borrar (solo inserción): `verificar` reinicia la base antes de Playwright y la restaura al final (reinicio e importación de las listas reales).

## Desviaciones y decisiones propias

1. **`castores` (bodega por Castores) se trata como salida de la bodega**: descuenta inventario y devenga renta. La especificación decía "solo origen = bodega_omar". Pregunta abajo.
2. **Recepción**: entra al inventario lo recibido (no lo facturado seguido de un ajuste); no hay movimiento `traspaso_puente`: la cuenta puente es un libro derivado de `compra_diferencia` y sus asignaciones. Sobrantes: solo pueden quedar en la puente.
3. **Pedidos directos de Isaac o Karen** (sin pasar por Mérida) no generan compra al proveedor: solo costean con el costo vigente del origen, sin inventario ni renta. La compra del lado del proveedor llega con la página de Proveedores completa (F3a). El seguro de $5 por pieza de Karen vía Isaac se captura a mano en la orden.
4. **Correcciones de nota** cambian importes (precios, envío, descuento, recargo), no piezas; una devolución de piezas queda para después. Lo cobrado de un pedido es el total de su nota vigente.
5. **Avisos**: el aviso NT-003 (piezas de la nota distintas de las que salen) no puede ocurrir por construcción (la nota sale de lo surtido); NT-009, 011, 018, 020, 021 y 022 y todos los que necesitan reloj son de M2d. Telegram y correo no existen aún (`canales_previstos` guarda a dónde irán).
6. **Interfaz de lectura sin zod**: los lectores de F2 convierten `*_cent` a `bigint` con una función genérica y tipos escritos a mano (los de F1 siguen con zod).
7. **Sin asientos contables** (`lineas_de_evento`, plan de cuentas): no están en el alcance pedido de F2; los hechos son asiento-ready.
8. **Solo hay 12 de los 17 pasos de `verificar`**: se agregaron tres (reinicio, entorno y restauración) y la duración total es 3.5 minutos.
9. Fuentes del PDF en WOFF 1 (`@fontsource`): fontkit falla al subconjuntar WOFF2.

## Problemas y avisos

- El servidor de la app (puerto 3100) estaba corriendo con una compilación vieja: `verificar` lo detuvo (solo si es de este repo) y ya no queda corriendo. La base local de RTM sigue levantada con las listas reales (75 modelos, 26 clientes, 0 pedidos); el Supabase ajeno de `likida-bitacoras` no se tocó.
- La hoja interna y los avisos están pensados para socios; nada de F2 es visible para Omar (el esquema `omar` sigue cerrado).
- No se probó en un teléfono real ni la hoja de compartir PDF (llega con F3b).

## Consumo

Alrededor de 330 llamadas a herramientas y varias horas de reloj de una sola sesión. Builds de Vercel: 0. Despliegues: 0. Paquetes npm agregados: `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist` (pruebas), `@fontsource/figtree` y `@fontsource/eb-garamond` (fuentes del PDF).

## Preguntas para la siguiente parada

1. ¿Los pedidos `castores` (bodega por Castores) devengan renta? Hoy sí.
2. ¿Plazo de cobro por omisión por cliente (hoy ninguno: "Sin plazo acordado") y recargo de 10 % por crédito automático o manual?
3. ¿Texto de marca y datos de pago de la nota (`nota_marca_texto`, `nota_datos_pago_texto`)? Hoy la marca es "RTM" y no hay datos de pago.
4. ¿Tope de tomas de Omar con revisión adicional (D10, 15 piezas) y caducidad de 72 h: se confirman?
5. ¿Los pedidos directos de Isaac o Karen deben crear su orden de compra del lado del proveedor desde F2 o hasta F3a?
6. ¿Las devoluciones de piezas de un pedido ya enviado se manejan como pedido negativo o como documento aparte?
7. Siguen abiertas las preguntas 1 a 16 del informe de F1 (monto de las transferencias a Isaac, remisión de las 12 piezas, equivalencias de nombres, etc.).
