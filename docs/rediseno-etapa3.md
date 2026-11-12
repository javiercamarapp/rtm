# Rediseño, etapa 3 (pulido)

Rama `rediseno/premium` (worktree `~/rtm-rediseno`), sobre la fusión de A1, A2 y A3. Sin push, 0 builds de Vercel, 0 despliegues, `~/rtm` intacto. Todo se verificó contra un Supabase local propio (proyecto `rtm-e3`, puertos 583xx; su `supabase/config.toml` está marcado `skip-worktree` y no se versiona) y servidores propios (dev en 3104, `next start` en 3100). Se reinició (`db reset`) solo esa instancia.

Método: `test/capturas/e3.spec.ts` (+ `playwright.capturas-e3.config.ts`) recorre las 46 rutas de A1, A2 y A3 en 1440, 1280 y 390, claro y oscuro, y además MIDE por página: tablas con columnas fuera de la caja, tarjetas hermanas con espacio vacío vertical, cola vacía antes del pie, scroll horizontal de página y gráficas con casi todo en cero. Las métricas quedan en `docs/capturas/rediseno-etapa3/metricas-*.txt`.

## Defectos del orquestador y cómo se corrigieron

| # | Defecto | Causa | Corrección | Antes -> después (1440 claro) |
|---|---|---|---|---|
| 1 | Kárdex cortado a la derecha, columna Existencias a medias | Etiquetas de bloque (ENTRADAS...) ensanchaban su columna; mínimos de ancho de 72-200 px; fechas, piezas y títulos largos | Etiquetas de bloque fuera del cálculo de ancho y sin recorte; mínimos 44/56/72/92/140; `truncar` con `title`; encabezados en dos líneas; fecha corta, piezas sin sufijo; orden de columnas (semáforo y cobertura antes de lo secundario); relleno denso de 8 px. Si aun así excede: **indicador de scroll horizontal** (desvanecido + botón «Más columnas →» / «← Atrás», caja enfocable por teclado). En 1440 el kárdex muestra completas las columnas clave y desplaza solo Referencia, Autor y Mensaje | Tablas con columnas clave cortadas: 13 (hasta +603 px) -> 0 con datos clave cortados; 4 con cola secundaria desplazable |
| 2 | Huecos verticales (inicio, kárdex, A2, A3) | Rejillas 8-4 con una tarjeta alta y otra corta; listas que no crecen | Recomposición: listas en 2 columnas (`BarList columnas={2}`, `LineaTiempo columnas={2}`) para tarjetas de ancho completo; tarjetas cortas apiladas que comparten fila con la alta (`rtm-pila-llena`); 8-4 a 6-6 donde la mitad de la pantalla lo pide; envolturas de bloque que estiran; listados que crecen hasta 96 px por fila; estados vacíos que llenan su tarjeta; inicio con «cobertura media por marca» y resumen de ventas (semana más alta, promedio, semanas con venta) | Tarjetas con vacío >56 px: 21 (máx. 399 px) -> 2 (93 y 102 px) |
| 3 | Gráficas semanales casi en cero muy altas | Altura fija de 168 px | `ColumnasPeriodo`: con menos del 40 % de periodos con dato baja a 104 px; con una sola semana con dato se reemplaza por un resumen compacto («9 nov: $35,500.00 (parcial). Las otras 7 semanas no tienen movimiento») | Inicio y pedidos pasaron de gráfica de 7 barras vacías a resumen; la serie de flujo queda a 104 px |
| 4 | Móvil: tablas anchas tapan cifras tras el scroll | Sin tarjeta-fila | `prioridadMovil` en `DataTable` (`titulo`, `principal`, `detalle`, `normal`, `oculta`, `etiquetaMovil`): en <=767 px cada fila es una tarjeta (título, cifra principal con etiqueta, rejilla de 3 datos, totales como tarjeta). Aplicada a pedidos, clientes, inventario (existencias y compras), kárdex, cuentas por cobrar (por pedido y por cliente), proveedores (4 tablas), libro y diario. Las demás tablas de más de una columna **deducen** prioridades (primera columna = título, última cifra = principal) | En 390: tablas principales sin cifras tapadas; quedan solo las tablas equivalentes de gráficas y unas pocas con scroll interno |
| 5 | Indicador del sidebar sin transformaciones 13 y 14 | `shell.css` llegaba a `data-indice=12` | Reglas 13 a 16 (34 px por destino). El aspecto no cambia | 15 destinos cubiertos |
| 6 | Pestañas y segmentados poco inequívocos | Activo = tinte tenue; foco por defecto | Segmentado y chip activos en tinta sólida con texto del panel; pestaña activa con relleno + subrayado de 3 px + `aria-current`; foco visible de 2 px en tinta en pestañas, segmentados y chips | |
| 7 | Contraste | Medido con `test/contratos/contraste.test.ts` (WCAG) | Ningún `--rtm-d-*` ni texto de la paleta falla (texto >= 4.5, marcas >= 3, en claro y oscuro). `--rtm-borde-tarjeta` (1.40:1) es decorativo y no se mide. **Fallaban** los bordes de controles (campos, botones, chips, segmentados) con `--rtm-line-2` (1.4:1): nuevo token `--rtm-borde-control: var(--rtm-line-strong)` (3.31-3.40 claro, 3.63-4.12 oscuro). Sin cambios en valores de paleta | |
| 8 | Pruebas | ver abajo | | |

Otros arreglos: `premium.css` es global (las reglas de rejilla estaban solo en `paginas-a1.css`, que sólo carga en A1); `rtm-a1-sub` y `rtm-a1-subtitulo` ahora son globales; el panel gana ancho útil (relleno 24/28 y tope del armazón en 1280); `Segmentado` y `CeldaPersona` aceptan `testid`.

## Pruebas

- `tsc`, `eslint`, guardas y `vitest` completos en verde (ver el resumen final del lote). Pruebas nuevas: contraste de tokens, tarjeta-fila móvil, `truncar`, indicador de scroll, listas en dos columnas.
- Playwright (Chromium laptop 1440, iPhone 16 Pro, plegable cerrado y abierto) contra Supabase propio con base limpia. Ajustes a las pruebas por cambios de estructura (sin debilitarlas): H1 del catálogo («N modelos en el catálogo»), «Cuadra» visible (la primera coincidencia estaba dentro de una tabla equivalente plegada), `Abonado` dentro de la región «Cifras del pedido», grupo «Actividades de operación» como botón del grupo colapsable, `data-testid` de ámbito y de estado de socio. Dos correcciones de producto que las pruebas destaparon: etiqueta de búsqueda del catálogo duplicada y campos de filtros de A2 y A3 a 13 px y 32 px en táctil (ahora 16 px y 44 px).

## Qué queda

- A 1280 el kárdex oculta los valores unitarios de entradas y salidas (columnas derivables; el CSV los conserva) y el resto desplaza con indicador; inventario, libro, antigüedad y caja desplazan su cola secundaria con indicador.
- Tarjetas con vacío residual de 93 px (saldo de la cuenta del proveedor, con botones anclados abajo) y 102 px (avisos: dos listas con subtítulo).
- La gráfica de flujo (12 semanas, 10 en cero) queda achatada a 104 px, no sustituida.
- `data-testid` perdidos en otras pantallas: se corrigieron los que las pruebas encontraron; no hay garantía fuera de lo que cubre Playwright.
- La etapa 4 (páginas que solo existen en main) no se tocó.
