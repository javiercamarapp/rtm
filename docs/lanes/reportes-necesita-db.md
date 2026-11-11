# Reportes: necesidades de base de datos

El carril no crea migraciones. Trabaja contra los puertos de `src/aplicacion/reportes/puertos.ts` con implementaciones en memoria. Para producir reportes reales hace falta:

- Funciones STABLE de lectura que entreguen `InsumosSemanal` e `InsumosMensual` (forma en `src/dominio/reportes/insumos.ts`): pedidos con lineas, costo promedio y precio de tabulador; inventario por modelo y sabor con ventas semanales y lead time; cartera por cliente; liquidacion por proveedor; gastos; cuenta de socios y de Omar; flujo; historia de 13 semanas por cliente; resultados de las comprobaciones contables C1 a C22.
- Tabla de reportes publicados por clave `tipo:inicio` y version, con folio, huella, estado, etiquetas, sha256 del PDF, indicadores de entrega por canal, el PDF y el HTML (contrato de `RepositorioReportes`).
- Tabla `config` con vigencia para los parametros de `PARAMETROS` (hoy constantes en codigo).
