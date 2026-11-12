# Carril devolucion-parcial: informe

Rama `lane/devolucion-parcial` (base `rediseno/premium`), worktree `~/rtm-lane-devolucion`. 0 builds de Vercel, 0 despliegues, sin push, sin tocar `~/rtm`, `~/rtm-deploy`, Vercel ni Supabase en la nube. Base local propia `rtm-dev` (puertos 613xx) y servidor propio en 3109.

## Que se hizo
Migraciones aditivas `20261113000100` a `000400` (prefijo posterior a la ultima de la rama, `20261112300000`):
- Recepcion parcial de compras: estado `recibida_parcial`, un lote por llegada (la suma de las llegadas es EXACTAMENTE el costo puesto de lo facturado: redondeo acumulado de mercancia, guia y seguro), cierre explicito con motivo que convierte lo que falta o sobra en diferencia (cuenta puente 1340), cierre automatico si todo llega exacto. `recibir_compra` (total) no cambia.
- Devolucion de cliente (nota de credito `DV-xxxx`): regresan piezas a Bodega Omar al valor al que salieron (o a merma si vienen danadas), baja la cuenta por cobrar por piezas x precio de la nota vigente, el excedente de pagos ya aplicados se libera a saldo a favor, anulacion con contramovimientos y reaplicacion FIFO. La nota original no cambia. `anular_pedido` se rechaza si hay devoluciones vigentes.
- Devolucion a proveedor (`DP-xxxx`): sale al costo promedio, la cuenta con Isaac o Karen sube por el mismo valor, anulacion.
- Contabilidad: Dr 4220 / Cr 1210 por la devolucion de cliente; 1320 reconoce lo pendiente de compras recibidas en parte; C14 resta 4220; `Explicar este numero` para saldo y total del pedido con devoluciones y para cada devolucion (`devolucion:cliente|proveedor:id`).
- API (`api.*`) y web: pagina `/devoluciones` (sidebar), seccion Devoluciones y dialogo en el pedido, llegadas parciales y cierre de recepcion en la orden de compra, PDF de nota de credito y de devolucion a proveedor con huella estable (se genera una vez y se guarda).
- Correccion de base ajena que bloqueaba toda verificacion visual: `premium.css` (commit 6b5e269 de la base) tenia `.rtm-region { display: contents; }`, que rompia el armazon en escritorio (el contenido caia en la columna del menu). Se quito esa linea; `shell.css` ya define la region.

## Comandos corridos y resultado real
- `supabase db reset` + `supabase test db`: 47 archivos, 2,295 pruebas; unico fallo `024_omar_cuenta_sin_folio` #13 (preexistente: usa fechas fijas y supone que hoy es 11-nov; ya documentado en `docs/union-produccion.md`). pgTAP nuevo `028_devoluciones_recepcion_parcial`: 89 pruebas OK, incluye C3, C4, C5, C7, C10, C14, C16, C18, CU1 a CU3 por dos vias, `reproducir_saldos` (clientes, saldos a favor, transito) tras recepcion parcial, devolucion de cliente con liberacion de pago, anulaciones y devolucion a proveedor.
- `npx vitest run`: 113 archivos, 1,731 pruebas OK (2 esperadas-falla preexistentes); nuevo `test/unit/devoluciones.test.ts` (13).
- `npx tsc --noEmit`, `eslint`, `npm run guardas` (0 violaciones) y `npm run secretos` (0 hallazgos): limpios.
- Playwright `playwright.devoluciones.config.ts` (laptop 1440 y iPhone 402) contra `next build` + `next start -p 3109`: 10/10 OK (llegadas parciales, cierre con faltante y motivo obligatorio, devolucion con tope de piezas, PDF de huella estable guardado una sola vez, anulaciones, devolucion a proveedor, identidad contable al final).
- Capturas: `docs/capturas/devoluciones/` (1440 por tramos y 390, claro y oscuro; sin desborde horizontal en 390). Se revisaron las imagenes y se corrigieron: dialogos con tabla recortada, "pz pz" duplicado, etiqueta del costo puesto en recepcion parcial.

## Reglas pendientes del dueno (no inventadas)
- El credito al cliente es piezas x precio de la nota vigente: no devuelve envio ni descuento.
- El credito del proveedor es el valor en libros; una diferencia pactada se captura con el ajuste de proveedor existente.
- Pedidos directos del proveedor (karen_directo, isaac_directo, karen_via_isaac) no admiten devolucion (se rechaza con mensaje).
- No hay reembolso en efectivo al cliente: el excedente pagado queda como saldo a favor.

## Pendientes
- Otras lanes pueden redefinir `contabilidad.lineas_de_evento`, `comprobaciones`, `reproducir_saldos` o `api.compra_detalle`: al integrar, repetir los parches de la migracion 000300 y 000400 sobre la version vigente.
- e2e movil solo corre el recorrido funcional; la revision visual movil fue por capturas.
