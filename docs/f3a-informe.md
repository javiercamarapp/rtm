# Informe de la fase F3a

Fecha: 11-nov-2026. Alcance: cuentas con proveedores (hoja y liquidación de los viernes), cuenta de socios con estado de cuenta, cascada de reparto y cierre firmado por los dos, cuenta con Omar y cuentas por cobrar completa, más la asignación de faltantes de recepción a un responsable. Todo local: sin push, sin remoto, sin Vercel, sin Supabase en la nube. **No se cargó ningún dato real de ventas, compras, pagos ni existencias**: pruebas, capturas y demostración usan fixtures ilustrativos y los casos dorados.

Regla nueva aplicada a mitad del paso (CLAUDE.md del repo): RTM se opera como un solo negocio. Las pantallas de F3a no filtran, agrupan ni muestran columnas por dueño del cliente; la cuenta de socios, el estado de cuenta, la cascada y los fondos en poder de un socio sí existen.

## Lo que se hizo

1. **Cuenta de socios y cascada (migración 0015).** Libro de lo que la sociedad le debe o le paga a cada socio (`socio_libro`, solo inserción), gasto pagado por un socio como gasto de la sociedad una sola vez más reembolso, aportaciones y retiros con eco del saldo y deshacer por contramovimiento, liquidación entre socios. `cuenta_socios()` calcula la diferencia de la compra por dos vías. La cascada es una función pura de cinco pasos (`cascada_calcular`) que se alimenta de los libros (`cascada_periodo`) y se cierra con propuesta, dos firmas y anulación antes de la segunda firma (`cierre_reparto`). Posición neta de un socio = aportaciones + libro − lo que debe a la sociedad; la cascada la deja en cero entre los dos cuando se liquida.
2. **Proveedores (0016).** Hoja de tres bloques por semana (nota por pedido a costo, cuenta con abonos y ajustes, guías por pedido) con cuatro comprobaciones calculadas por una segunda consulta; falta por saldar = saldo anterior + costo total con guías − pagos − ajustes; conciliación contra lo que dice el proveedor renglón por renglón; cierre desde el viernes que congela la hoja; ajustes y pagos de la sociedad con deshacer; texto para copiar al proveedor sin nombres de clientes; Karen vía Isaac reparte mercancía (Karen) y seguro y guía (Isaac). Isaac y Karen nunca se mezclan.
3. **Omar y cuentas por cobrar (0017).** `api.omar_cuenta` con renta por pieza surtida, tomas, pendientes de autorización (con caducidad), pagos, liquidaciones y semana anterior sin cerrar; `omar.v_mi_cuenta` preparada pero cerrada (cero filas mientras no haya un Omar activo; lista negra de columnas verificada). Cuentas por cobrar: recargo por crédito como corrección enlazada de la nota, concentración por cliente, antigüedad, texto de cobro para copiar, recordatorios idempotentes y antigüedad de los fondos en poder de un socio.
4. **Explicar este número** para diferencia entre socios, posición neta, falta por saldar, neto de Omar, utilidad del periodo y resultado de cada socio en la cascada, todos con comprobación por dos vías.
5. **Pantallas.** `/proveedores/liquidacion`, `/socios` (barra divergente con el signo escrito), `/socios/[socio]`, `/socios/cascada` (cinco pasos, gráfica de cascada, saldo entre socios y cierres con firmas), `/omar`, `/cuentas-por-cobrar` ampliada y los diálogos de captura. Avisos emitidos: NT-045 (cascada lista para firma), NT-046 (utilidad mayor que el efectivo), NT-047 (cierre firmado), NT-035 y NT-043 (por un emisor que hoy se llama a mano).

## Pruebas a mano de la Parada 3, ya automatizadas

| Prueba | Dónde | Resultado |
|---|---|---|
| Nota de Villa 13,590.00 con 62 piezas | `008_pedidos` (F2) | pasa |
| Hoja de Isaac: 12 renglones = 284,540.00; 11 guías = 7,105.00; Villa a costo 9,430.00; falta por saldar con pagos y descuento = 40,645.00 | `013_f3a_proveedores` | pasa |
| Diferencia entre socios: costo 140,615.00, mitad 70,307.50, Angelo 84,615.00, Javier 56,000.00, Javier debe a Angelo 14,307.50 por dos vías, 1,440.00 fuera de la sociedad | `012_f3a_socios` (G3, por diferencias contra la base de partida) | pasa |
| Omar: 300 × 2 = 4 × 150 saldo cero; 220 × 2 contra 4 × 175 = −260.00; 428 × 2 contra 4 × 150 = +256.00; renta cero en directos | `014_f3a_omar_cxc` y `009_pagos_omar` | pasa |
| Ejemplo de la adenda 21: Angelo 6,500 y Javier 8,221, Angelo entrega 1,500 a Javier | `012_f3a_socios`, puro y de punta a punta con cierre firmado | pasa |
| Efectivo insuficiente, utilidad negativa, aportación devuelta parcialmente, gasto capturado dos veces, identidad de lo asignado | `012_f3a_socios` más 400 casos generados | pasa |
| Pago de 9,000.00 de un cliente a la cuenta de Angelo, compensado pagando a Isaac | `009_pagos_omar` (F2) | pasa |
| Faltante de 12 piezas asignado a Angelo (1,098.55), puente en cero, liquidación | `012_f3a_socios` y `007_compras` | pasa |

## Cómo se verificó

```
OK     Tipos (tsc)
OK     Lint y fronteras entre capas (eslint)
OK     Guardas estaticas de diseno y dominio
OK     Escaner de secretos y correos
OK     Pruebas unitarias y de contratos (vitest)                 1190 pruebas en 64 archivos
OK     Entorno local (.env.local y rol servidor)
OK     Pruebas de base de datos (pgTAP)                          576 afirmaciones en 14 archivos
OK     Pruebas de integracion con la base local
OK     Importador: idempotencia con fixtures
OK     Importador sobre las fuentes reales (43 costos, 19 clientes, 179 lineas, 12 en cero, 17 de Karen)
OK     Reinicio de la base local
OK     Entorno local tras el reinicio
OK     Pruebas de pantallas y acceso (Playwright)               68 pasadas
VERIFICAR: OK (13 pasos, 285.4 s)
```

Playwright: laptop 1440, iPhone 16 Pro (WebKit 402x874), plegable cerrado (344) y abierto (880): sin scroll horizontal, objetivos de 44 px, campos de 16 px y diálogos dentro de la pantalla en las ocho rutas nuevas. Capturas: 320 en `docs/capturas/f3a/` (Chromium y WebKit, claro y oscuro, 1440x900, 402x874, 344x882 y 880x860, 20 pantallas) con `manifest.md`; se regeneran con `npm run capturas:f3a`.

## Defectos encontrados y corregidos en el camino

- `008_pedidos` (F2) tenía la fecha `2026-11-10` fija mientras sus entradas usan la fecha de hoy: falló al cambiar el día. Ahora usa `negocio.hoy()`.
- Mi prueba de la hoja hacía clic en el formulario antes de que terminara la navegación al alcance "Todo" y guardaba lo que dice el proveedor en el alcance equivocado (falló solo en la corrida completa). Ahora espera la URL y el estado activo.
- Una guarda estática prohíbe estilos en línea: la barra divergente usa 51 clases de ancho en lugar de `style`.
- Los mapas de centavos solo se convierten a `bigint` si su clave termina en `_cent`: `pagos_por_concepto` pasó a `pagos_por_concepto_cent`.

## Desviaciones y decisiones propias

1. **Dueño del cliente.** F3a no lo usa en ninguna pantalla. Las pantallas de F1 y F2 (pedidos, pedido, clientes, catálogo, paquetes por hacer) todavía muestran filtros o columnas de dueño: no se tocaron en este paso y siguen contra la regla nueva. Hace falta un paso de limpieza.
2. **Alcance de la hoja.** El plan decía "Todo, por dueño"; queda "Solo de la sociedad | Todo". `fijar_ambito_pedido` existe como función y acción, sin botón en pantalla.
3. **Efectivo de la cascada.** El sistema no sigue la cuenta bancaria de la sociedad: el efectivo es lo que los socios tienen en su poder más el "efectivo en la cuenta de la sociedad" que se captura al calcular o proponer (por omisión cero).
4. **Utilidad del periodo.** Aproximación operativa: utilidad de pedidos enviados (con sus correcciones) + tomas de Omar a su precio − gastos generales (incluidos los pagados por socios y sin los de guía, que ya están en el pedido). No incluye mermas ni diferencias de recepción; el estado de resultados contable llega con los asientos. Es provisional mientras haya guías sin costo real.
5. **Cierre.** Se propone solo para un periodo que ya terminó, sin traslapes. Al firmar los dos se asientan la utilidad asignada y los reembolsos y devoluciones pagados por la cascada, que se compensan contra lo que cada socio tenía. La utilidad asignada queda en la posición neta hasta que se liquide entre socios o se pague. Un cierre firmado no se anula: se corrige en el siguiente periodo.
6. **Reglas de reparto que el dueño resolvió el 11-nov, después de construir la cascada (CLAUDE.md, líneas B, D, E, F):** E y F ya coinciden con lo construido. Faltan por ajustar: (D) las pérdidas se reparten 50/50 y se arrastran al periodo siguiente (hoy la pérdida solo se muestra y no se arrastra); (B) orden de fondeo con efectivo de caja primero y "cuentas de efectivo" por persona extensibles a bancos (hoy el efectivo de la sociedad es una captura manual); (F) el dinero extra de un socio como financiamiento temporal y no como capital por omisión (hoy `registrar_aportacion` y el pago de un socio a un proveedor con dinero propio entran como capital). Quedan como trabajo del siguiente paso.
7. **Puntos abiertos del documento 31 que se trataron como parámetros antes de esa resolución:** A (devolver aportación antes de repartir: sí, con bandera `cascada_devolver_aportaciones_antes`), B (sin reserva de inventario), D (la pérdida no se reparte ni se carga a los socios: solo se muestra), E (el centavo suelto va a favor de quien tiene más reembolso y aportación pendientes), F (50/50 fijo; las aportaciones desiguales solo se devuelven).
8. **Semana de liquidación con proveedores:** de sábado a viernes (lo enviado el fin de semana entra a la siguiente), cierre a partir del viernes.
9. **Recordatorios con tiempo** (NT-035, NT-043): el emisor `emitir_recordatorios_cobro` existe y es idempotente, pero nadie lo llama solo hasta que haya reloj (M2d).
10. **"Cada renglón abre el cajón"** en el libro de movimientos: las cifras clave sí abren el cajón; el renglón del libro muestra evento, quién y mensaje original pero no abre uno propio.
11. **Vista de Omar:** solo la vista de base de datos, cerrada; no hay página para Omar. "Exportar" es un CSV de la semana generado en el navegador a partir de textos ya calculados.
12. Los pgTAP de F3a neutralizan los saldos de partida dentro de su transacción, pero asumen una base sin hechos de pantallas: corren bien en `verificar` (que reinicia antes de Playwright y restaura después) y pueden fallar si se corre Playwright a mano y luego pgTAP sin reiniciar.

## Problemas y avisos

- El primer paso de F2 que había dejado la base con listas reales sigue igual: al terminar la base local queda con las listas reales importadas (75 modelos) y sin pedidos. El Supabase ajeno de `likida-bitacoras` no se tocó. No quedan servidores ni la base de RTM corriendo.
- No se probó en un teléfono real.

## Consumo

Builds de Vercel: 0. Despliegues: 0. Paquetes npm agregados: ninguno.

## Preguntas para el dueño

1. Documento 31, puntos A y C siguen abiertos: aportación de capital en el primer cierre con efectivo o dejada en inventario; frecuencia del cierre y quién firma.
2. ¿De dónde sale el efectivo en la cuenta de la sociedad para la cascada: captura manual en cada cierre o una cuenta que se lleva en el sistema?
3. ¿Plazo de cobro por omisión por cliente y recargo de 10 % automático o a mano (hoy a mano, con 10 % sugerido)? ¿A cuántos días sin entregar se alerta a un socio (hoy 7) y a cuántos es crítica?
4. ¿La liquidación con Isaac se cierra siempre con "Todo" (la hoja que él cobra) o con "Solo de la sociedad"? Hoy cada alcance tiene su propio cierre.
5. ¿Texto de marca y datos de pago para el texto de cobro (`nota_datos_pago_texto`)? Sin ellos el texto sale sin datos de pago.
6. Siguen abiertas las preguntas 1 a 7 del informe de F2 y las de F1.
