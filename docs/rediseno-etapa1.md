# Rediseño, etapa 1: tokens, componentes, DataTable v2 y gráficas

Rama `rediseno/premium` (worktree `~/rtm-rediseno`). Sin push, sin builds, sin tocar `~/rtm`. Especificación: `~/.rtm-diseno-analisis/RTM-ESPECIFICACION-DE-DISENO.md` y `paridad-excel-union.md`. Galería viva: `/diseno/componentes`; capturas en `docs/capturas/rediseno/`.

## Tipografía
Geist (variable) para toda la UI y Geist Mono solo en folios, claves y huellas (`.rtm-mono`). Un solo token: `--rtm-fuente-ui` (volver a otra familia = una línea en `tokens.css` y `src/ui/tipografia.ts`). Verificado en navegador: 1111, 0000 y 8888 miden igual con `tabular-nums` (64.73 px a 26/600). Se quitó `font-feature-settings: cv11, ss01` heredado. Escala: página 24/600, KPI 26/600, cifra grande 32/600 (ficha y cajón "Explicar"), sección 14/600, cuerpo 13-14, etiqueta 11-12 mayúsculas con tracking. Sin pesos 300 ni 700 ni cifras de 44/56.
- Login: conserva su tipografía propia (Fraunces, Instrument Sans, IBM Plex Mono en `src/app/login/*`) porque está protegido por exenciones por hash y un fixture de paridad (`test/fixtures/referencia-likida`); migrarlo exige actualizar esas huellas. Pendiente decidir con el dueño.
- PDF de notas y reportes: siguen incrustando Figtree y Garamond `.woff` (fontkit no subconjunta bien WOFF2). Pasada aparte.

## Tokens nuevos (`src/ui/estilos/tokens.css`)
Escala, ritmo (`--rtm-ritmo` 12, `--rtm-pad-tarjeta` 14), anchos de página, controles (`--rtm-r-ctl` 8, `--rtm-h-ctl` 32), tablas (`--rtm-h-fila` 40 / densa 32 / libro 28, cabecera 36), `--rtm-borde-tarjeta` (= `--rtm-line-2`), filete 3 px, gráficas (rejilla, eje, hover, tooltip 160-280), capas `--rtm-z-*`, movimiento (barras 420 ms, trazo 380 ms) y tintes de estado `--rtm-tinte-ok|warn|bad|info` derivados con `color-mix` de la paleta. No cambian sidebar, fondo ni paleta.

## Componentes (`src/ui/componentes/`)
Estilos en `src/ui/estilos/premium.css`. Ningún estilo en línea: las barras son SVG.
- `pagina.tsx`: `EncabezadoPagina` v2 (`titulo`|`antes/enfasis/despues`, `descripcion`|`contexto`, `eyebrow`, `acciones`, `migaja`), `Pagina` (`ancho`), `Tarjeta` (`titulo`, `descripcion`, `acciones`, `plana`, `elevable`), `Rejilla` (`dividir` 12, 8-4, 4-8, 6-6, 9-3, 4-4-4, 3-3-3-3; apila en <=1000 px), `EstadoVacio`, `EstadoError`.
- `kpi.tsx`: `KpiLinea { celdas, variante: 'linea'|'tarjetas', etiquetaAria }`; `KpiCelda { id, etiqueta, valor|null, delta, spark, partes, progreso, nota, categoria 1-8, href, ayuda }`. `null` = "Sin dato" y no dibuja visuales; sparkline solo con >= 2 puntos reales. `FilaRatios`.
- `controles.tsx`: `Chip`, `ChipEstado`, `Segmentado` (filtro de periodo, enlaces), `Pestanas` (con contador), `BarraFiltros` (una línea), `Monograma` (cuadrado, radio 8), `CeldaPersona`, `Aviso`.
- `datos.tsx`: `BarList` (`pct: null` = pista rayada, nunca 0), `ListaHallazgos`, `Pasos`, `LineaTiempo`, `ListaClaveValor`, `Paginador` (enlaces).
- `data-table.tsx` (DataTable v2, compatible hacia atrás) + `tabla-interactiva.tsx` (capa cliente).
  - `densidad: 'normal'|'densa'|'libro'`, `plana`, `pegajosa` (encabezado fijo, 62dvh), `primeraFija`, `totales { etiqueta, celdas }` (pie fijo; deben ser del filtro completo), `agrupar { clave, cabecera(clave, filas) -> { titulo, subtotales }, cerradosPorDefecto }`, `pestanas { etiquetaAria, items[{ id, etiqueta, href, activa, contador }] }`, `interactiva { busqueda, porPagina, exportar }`.
  - Columna: `ancho` xs|s|m|l|xl, `bloque` ("Entradas", "Salidas", "Existencias": fila de cabecera de grupo), `resaltar(fila) -> 'cero'|'negativo'|null` (color y palabra Agotado/Negativa), `numerica`, `secundaria`.
  - Sombra de scroll horizontal por CSS; sin JS todas las filas se ven. CSV exporta lo visible (neutraliza `= + @`).
  - Búsqueda, paginación y grupos operan sobre las filas ya renderizadas. Para totales del filtro completo hay que calcularlos en servidor (tablas de >200 filas: paginar en servidor y usar `Paginador`).
- `Delta` único en `src/ui/graficas/delta.tsx` (acepta `bueno` para tinte ok/malo).
- Se eliminó el borrador `src/ui/premium/` (sin degradados, sin cifras ligeras). Sin `TarjetaHeroe` ni escala degradada.

## Gráficas (`src/ui/graficas/`)
- `ColumnasPeriodo`: ancho real (`useAnchoReal`), eje cero, 3 marcas, máximo y último completo en tinta plena, resto al 58 %, periodo parcial con trama, tooltip en 4 niveles (cursor y teclado) y cinta fija en táctil. Pasa por `MarcoGrafica` (procedencia, tabla, pie, esqueleto).
- `AreaSerie`: línea 1.75 px, relleno plano 12 % (sin degradado), cruceta con tooltip, tramo parcial discontinuo con círculo hueco.
- `EscalaSalud`: tres tramos con palabra y marcador (su CSS vive en `premium.css` porque la regla del proyecto prohíbe semáforos dentro de `graficas.css`).
- `escalas.ts`: `escalaBonita`, `compactoEs` (puras, con prueba). `TooltipGrafica`, `CintaLectura`, `ContenidoTip`.
- Barras horizontales de desglose = `BarList`. Cascada, procedencia (`MarcaProcedencia`) y cobertura ya existían y no cambiaron.
- Pendiente (etapa de páginas): migrar `GraficaBarras`/`GraficaLinea` a `MarcoGrafica`, quitar `min-width: 480px` de las gráficas con `viewBox` y bajar sus animaciones a 420/380 ms.

## Cómo usarlos
```tsx
<Pagina ancho="tablero">
  <EncabezadoPagina eyebrow="Inventario" titulo="1,524 piezas en la bodega" descripcion="Existencia por modelo y sabor a costo promedio." acciones={<Segmentado ... />} />
  <KpiLinea etiquetaAria="Indicadores" celdas={[{ id: 'v', etiqueta: 'Valor', valor: texto, categoria: 1, delta: { texto: '+4 %', sentido: 'sube', bueno: true } }]} />
  <Rejilla dividir="8-4"><Tarjeta titulo="..."><ColumnasPeriodo .../></Tarjeta><Tarjeta titulo="..."><BarList .../></Tarjeta></Rejilla>
  <Tarjeta plana titulo="Kárdex"><DataTable densidad="libro" pegajosa primeraFija agrupar={...} totales={...} interactiva={{ busqueda: 'Buscar', porPagina: 50, exportar: 'kardex' }} .../></Tarjeta>
</Pagina>
```
Ver `src/ui/galeria/galeria.tsx` (datos ilustrativos).

## Verificación
`tsc`, `eslint`, guardas (0), `vitest run` completo (73 archivos, 1281 pruebas, incluye `src/ui/componentes/catalogo.test.tsx`, `src/ui/graficas/escalas.test.ts` y axe sobre la galería). Capturas 1440 y 390 en claro y oscuro revisadas a ojo; 390 sin scroll horizontal de página. Contraste de los `--rtm-d-*` como texto y la nitidez de `--rtm-borde-tarjeta` sobre el panel claro: borde visible en las capturas, contraste no medido numéricamente.

## Notas para la etapa de páginas
- El indicador del sidebar (`shell.css`) solo tiene transformaciones hasta `data-indice='12'`; revisar si hay 15 destinos (no se tocó).
- Los cambios de escala (fila 40, H1 24) ya afectan a todas las páginas actuales; no se rehizo ninguna página.
- Móvil: las tablas hacen scroll interno con primera columna fija; la tarjeta-fila (`prioridadMovil`) no está hecha.
- `grep -rn duenio src/app` sigue mostrando pedidos, clientes y catálogo: se corrige en las páginas.
