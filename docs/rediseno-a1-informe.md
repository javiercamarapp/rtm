# Rediseño A1: informe por página

Rama `rediseno/pag-a1` (worktree `~/rtm-rediseno-a1`, desde `rediseno/premium` en 4d4db8d). Sin push, sin builds de Vercel, sin despliegues, sin migraciones nuevas (todas las cifras salen de lecturas ya existentes más agregados puros en `src/dominio/tablero/agregados.ts`, con prueba en `test/unit/tablero-agregados.test.ts`). Estilos propios en `src/ui/estilos/paginas-a1.css`; ayudas en `src/app/(socio)/_a1/comun.ts`. Capturas en `docs/capturas/rediseno-a1/` (manifest.md).

Regla del dueño aplicada: ninguna página mía filtra, agrupa, columna ni etiqueta por Angelo/Javier. Se conserva solo «Precio pactado por Angelo/Javier» (origen del precio en la ficha del cliente).

## Inicio (`/`)
Muestra: encabezado con subtítulo de dato clave y filtro de periodo (4, 8, 12 semanas); 4 KPI del pulso (Isaac, por cobrar con barra de antigüedad, entre socios, en bodega) con enlaces y los `data-testid` previos; 4 KPI de operación (ventas de la semana con delta y sparkline, utilidad provisional, pedidos por enviar, vencido con barra); fila de ratios (cobertura media, modelos por reponer, apartadas, clientes con saldo, saldos a favor, pagos sin identificar); aviso de pagos sin identificar; ventas por semana (columnas), cobertura de los modelos por reponer, antigüedad de saldos, mayores saldos, tu turno, valor del inventario por marca y pedidos recientes con pie de totales.
Datos: `pulso`, `tuTurno`, inventario completo, `cuentasPorCobrar` y `pedidos` (lecturas existentes). Ausente = «Sin dato».
Pendiente: serie histórica del pulso (no existe función de base); utilidad solo de pedidos enviados con utilidad registrada (provisional si lo es).

## Pedidos (lista, nuevo, detalle)
Lista: pestañas de estado con conteo, chips de origen y «Con avisos», 4 KPI, ratios (cobrado, utilidad, margen, ticket, por cobrar, surtido), piezas pedidas por semana, estados y origen, tabla densa con búsqueda, paginación, CSV y totales del filtro. Sin filtro ni columna de dueño.
Detalle: migaja, avance por pasos (solicitado a cobrado), 5 KPI (total, costo, utilidad, abonado, por cobrar con `CifraComprobada`), datos del pedido, cargos y pagos, pestañas Nota / Hoja interna / Versiones, cascada gráfica de la venta a la utilidad (provisional marcada), línea de tiempo. Se conservan testids y textos de nota y comprobaciones.
Nuevo: KPI del catálogo del cliente (sabores con existencia, con precio, mínimo, envío); selector sin dueño.
Pendiente: vista rápida en cajón (la fila abre el detalle); gráfica de surtido por semana separada (hoy solo piezas pedidas).

## Clientes (lista, ficha)
Lista: vistas Todos / Con saldo / Con saldo vencido / Bajan de ritmo con conteo, 4 KPI, ratios de cartera, concentración (Pareto desde 4 clientes con ventas; con menos, barras), mayores saldos o clientes que bajan, tabla densa con ventas, saldo, última compra y estado de cobro. «Bajan de ritmo» da «Sin dato» sin 3 pedidos y 4 semanas de historia.
Ficha: 5 KPI (compra acumulada, saldo, pedidos, utilidad dejada, margen medio), historial de precio, margen por modelo contra Isaac y Karen, tabulador, pedidos y historial de precios.
Nota: no existen páginas separadas de nuevo/editar/precios en esta rama.

## Catálogo
4 KPI (modelos, sin precio, costos supuestos, no disponibles), ratios, costo contra precio más alto, rango de precios, filtros por disponibilidad y marca, búsqueda, tabla densa con el botón de disponibilidad existente y tabla de precios por cliente sin columna de dueño. Costos solo para socios.

## Paquetes (por hacer, en trayecto)
Por hacer: 4 KPI (`ph-*`), ratios, aviso de falta de existencia (`falta-sabor`), horas sin enviar contra umbral, existencia contra surtido, tablas densas con totales y las acciones existentes.
En trayecto: 4 KPI (`pt-*`), ratios, días en camino contra plazo, piezas por proveedor, tabla densa con totales.

## Avisos
Chips de severidad y pestañas, 4 KPI, ratios, pendientes por atender, desglose por tipo y estado, tabla densa con «marcar leído». Pendiente: matriz de preferencias por canal (no existe en esta rama).

## Notas y operación
`notas/[notaId]/pdf` es una ruta sin interfaz y `operacion/` solo contiene componentes y acciones compartidas: no requirieron diseño de página.

## Cambios en pruebas
`test/e2e/f1.spec.ts` (clientes ya no filtra ni muestra dueño) y `test/e2e/f2.spec.ts` (el selector de cliente ya no lleva el dueño entre paréntesis). No se ejecutaron los e2e completos (requieren servidor en 3100 y base reiniciada por otros flujos).

## Cambio compartido
`compartido:` margen izquierdo de ColumnasPeriodo y AreaSerie de 36/40 a 46 px (las marcas «40 mil» se cortaban).

## Entorno
Instancia Supabase propia `rtm-a1` (puertos 563xx; `supabase/config.toml` modificado solo en el árbol de trabajo, no versionado), sembrada con los scripts demo; servidor `next start -p 3101`. Todo se detiene al terminar.
