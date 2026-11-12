# Carril devolucion-parcial: informe

Rama lane/devolucion-parcial (base rediseno/premium), worktree ~/rtm-lane-devolucion. 0 builds, 0 despliegues, sin push.

## Hecho
- Migraciones aditivas 20261113000100 a 000400: recepcion parcial (estado recibida_parcial, un lote por llegada, cierre con faltante/sobrante y motivo), devolucion de cliente (nota de credito DV, kardex, baja de CxC, libera pagos a saldo a favor, anulacion), devolucion a proveedor (DP, sale a costo promedio, sube cuenta del proveedor, anulacion), asientos (4220/1210, 1320/1340) y controles C14 y 1320 ajustados, Explicar este numero, API.
- Web: pagina /devoluciones, seccion de devoluciones en el pedido, llegadas parciales en la orden de compra, PDF de nota de credito con huella estable.
- Reglas pendientes del dueno: el credito del cliente excluye envio y descuento; devolucion de pedidos directos del proveedor no soportada (rechazada con mensaje).

## Verificacion real
- pgTAP nuevo 028: 88 pruebas OK (identidad contable C3,C4,C5,C7,C10,C14,C16,C18,CU1-3 por dos vias). Suite completa tras db reset: 47 archivos, unico fallo 024 #13 (preexistente, depende de la fecha; documentado en union-produccion.md).
- vitest completo: 1729 pasan (tras ajustar guardas_paginas); test/unit/devoluciones.test.ts 13 OK.
- tsc, eslint y guardas: limpios.
- e2e test/e2e/devoluciones.spec.ts (laptop-1440): 5/5 OK contra base propia rtm-dev (puertos 613xx) y next dev 3109.

## Pendiente
- Capturas: la unica captura tomada (fullPage) salio con el armazon roto y la descarte; hay que tomarlas con el metodo de test/capturas/a1.spec.ts (alargar viewport). Existen archivos sin versionar playwright.capturas-devoluciones.config.ts y test/capturas/devoluciones.spec.ts que no son mios.
- e2e movil (iphone) no corrido. Sin revisar visualmente la pantalla.
- Detenido por carga de la Mac; supabase stop de rtm-dev dio error de prune (contenedores supabase_*_rtm-dev pueden seguir arriba).
