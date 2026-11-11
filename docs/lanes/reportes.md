# Carril reportes: motor de reportes tipo consultora

Rama `lane/reportes`. Implementa el motor descrito en la especificacion 16 (reportes) con las secciones 2, 3, 8, 12 y 13 de la spec compacta. Todo el dinero va en centavos `bigint`; el motor no lee la base, el reloj ni la red: recibe insumos y devuelve un paquete inmutable. El modelo de IA no calcula dinero ni interviene en este modulo.

## Que se construyo

Capa dominio (`src/dominio/reportes/`), puro y sin I/O:

- `tipos.ts`, `cifras.ts`, `util.ts`, `formato.ts`, `texto.ts`: cifra con clase (Observado, Calculado, Estimado, Escenario, Declarado), comprobacion de doble via (`via1`/`via2`), errores tipados `ErrorReporte` con codigos (`CIFRA_INEXISTENTE`, `CIFRA_SIN_DATOS`, `GUARDIA_NUMEROS`, `PUENTE_NO_CUADRA`, `COMPROBACION_BLOQUEANTE`, `DATOS_INVALIDOS`, `RENDER_PDF`, `PDF_INVALIDO`) y formato de pesos, porcentajes y razones.
- `insumos.ts`: forma de lo que la base debe entregar (pedidos, inventario por modelo y sabor, cartera, liquidacion por proveedor, gastos, socios, flujo, historia por cliente).
- `parametros.ts`: umbrales y muestras minimas (algunos marcados para recalibrar con 8 a 12 semanas de datos reales); se imprimen en el anexo.
- `puente.ts`: puente de utilidad exacto (volumen, mezcla, precio, costo, guia, otros) que debe cuadrar al centavo.
- `proyecciones.ts`: promedio movil exponencial, tendencia lineal, estacionalidad, punto de reorden, proximo pedido, flujo de caja, fin de mes de Omar y escenarios. Sin muestra minima no se emite: devuelve `NoEmite` con cuantas semanas faltan; lo emitido lleva la etiqueta "Estimado; no es garantía" o "Escenario".
- `insights.ts`: 25 plantillas deterministas (I01 a I25) con regla, umbral y muestra minima, mas recomendaciones priorizadas.
- `estado.ts`: DEFINITIVO, PRELIMINAR, PARCIAL; si falla una comprobacion bloqueante (C3, C4, C5, C10, C11, C12, y toda R.*) el reporte no sale.
- `guardia.ts`: guardia de numeros; cualquier cifra en un texto que no pertenezca al paquete lo rechaza.
- `paquete.ts`: `armarPaquete(insumos)` produce el paquete con libro de cifras, comprobaciones, graficas, tablas, insights y huella.
- `svg.ts`, `paginas.ts`, `html.ts`: graficas SVG en blanco y negro, modelo de paginas y HTML Carta.
- `entrega.ts`: textos de Telegram, correo y aviso de "no sale" de una linea.

Capa aplicacion (`src/aplicacion/reportes/`):

- `puertos.ts`: `FuenteInsumos`, `RenderizadorPdf`, `RepositorioReportes`, `EntregaReportes`.
- `generar_reporte.ts`: caso de uso `generarReporte(solicitud, dependencias)` y `verificarPdf`.
- `entrega.ts`: entrega idempotente por canal.

Capa infra (`src/infra/reportes/`): `render_pdf_chromium.ts` (Chromium de Playwright, un trabajo a la vez, sin red, fuentes locales), `posproceso_pdf.ts` (fecha, ID y producer fijos para hash estable), `fuentes_css.ts` (WOFF2 locales como data URI), `memoria.ts` (repositorio, entrega, fuente y renderizador falso en memoria para pruebas).

## Contratos y reglas

- Idempotencia por clave `tipo:inicio` (por ejemplo `semanal:2026-11-02`). Misma huella: no regenera ni reenvia; si un canal quedo pendiente, el reintento envia solo lo que falta. Huella distinta: version nueva, la anterior se conserva.
- Si falla una comprobacion bloqueante: el PDF no se genera, queda borrador con la etiqueta BORRADOR, se envia solo un aviso de una linea al grupo de socios y no se manda correo.
- El PDF se genera una vez y correo y Telegram envian el mismo archivo (un hash SHA-256). Antes de entregarse se verifica: una pagina por hoja del modelo mas el anexo, sin desborde, fuentes incrustadas.
- Destinatarios: `telegramSocios` es el grupo de socios, nunca el chat de Omar; `correoDuenos` va a los dos dueños, nunca a Omar.
- El texto del reporte pasa por la guardia de numeros; una cifra fuera del paquete es un error `GUARDIA_NUMEROS`.
- No se nombra al proveedor Karen por otro alias en codigo de usuario ni se menciona la pagina de origen del scraper; este modulo no toca el scraper.

## Como integrarlo

1. Implementar `FuenteInsumos` contra las funciones STABLE de contabilidad (ver `docs/lanes/reportes-necesita-db.md`) y devolver `InsumosSemanal` o `InsumosMensual`.
2. Implementar `RepositorioReportes` y `EntregaReportes` (Telegram y correo) en la composicion; el modulo de notificaciones es dueño del canal real.
3. En composicion: `cargarCssFuentes(dirFuentes)` y `new RenderizadorChromium({ fecha14 })` donde `fecha14` es el cierre del periodo (AAAAMMDDHHMMSS).
4. Disparar `generarReporte({ tipo, inicio }, deps)` desde el cron semanal (lunes) y mensual (dia 1). Ejecutar un reporte a la vez por el candado del renderizador.
5. Mientras no existan los adaptadores reales se usan `RepositorioMemoria`, `EntregaMemoria`, `FuenteMemoria` y `RenderizadorFalso`.

## Pruebas y cobertura (medido en esta rama)

- `npm run typecheck`, `npm run lint`, `npm run guardas` (0 violaciones) y `npm run secretos` (0 hallazgos): verdes.
- `npm test`: 28 archivos, 384 pruebas, todas pasan; 10 archivos y 234 pruebas son del modulo (`test/unit/reportes`).
- Cobertura de lineas del modulo: 94.88 % (2781 de 2931 lineas, 22 archivos) con `node scripts/ci/cobertura-reportes.mjs` (minimo 90 %). Por archivo el menor es `render_pdf_chromium.ts` con 69.8 %, porque la prueba de PDF real con Chromium se omite si no hay Chromium instalado; `dominio/reportes/entrega.ts` queda en 87.3 %. El agregado del modulo cumple el minimo.
- Reportes dorados semanal y mensual en `test/fixtures/reportes`, guardia de numeros con mutacion, casos de datos escasos y fallo de bloqueantes.
- Pruebas de propiedades con fast-check en formato, estado, guardia, puente, proyecciones y reportes dorados. No hay componentes de interfaz en este carril, por eso no aplica axe.

## Choques con la spec y adendas

Ninguno detectado con las adendas 20 a 29 en lo que toca a este modulo. Las adendas de cobro y cuentas por cobrar (20, 22) y la cascada de reparto (21) definen cifras que la fuente debe entregar ya calculadas; este motor solo las presenta y las comprueba.
