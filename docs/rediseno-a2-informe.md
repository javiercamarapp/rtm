# Rediseño etapa 2 (A2): inventario y vistas de datos tipo Excel

Rama `rediseno/pag-a2` (worktree `~/rtm-rediseno-a2`, desde `rediseno/premium` en 4d4db8d). Sin push, sin despliegues, 0 builds de Vercel. Fuente de requisitos: `paridad-excel-union.md` (V1 a V8) y la especificación de diseño. Capturas: `docs/capturas/rediseno-a2/` (1440 y 390, claro y oscuro, con `manifest.md`; ninguna con scroll horizontal de página).

## Migración y acceso a datos
`supabase/migrations/20261112200000_a2_lecturas_enterprise.sql` (solo lectura, `api.*`, `stable`, `security definer`, `search_path` vacío, `exigir_rol(socio)`, sin ejecución para anon): `inventario_kardex_consolidado`, `inventario_detalle`, `inventario_resumen_marca`, `inventario_mermas`, `conta_valuacion_detalle`, `conta_valuacion_serie`, `caja_resumen`, `libro_dinero`. Prueba pgTAP `022_a2_lecturas_enterprise.test.sql` (64 pruebas: seguridad, kárdex con saldo inicial y cuadre, por sabor, detalle, marcas, mermas, libro con saldo corrido, caja y valuación; pasó 64/64 en base limpia). Acceso: `src/infra/supabase/datos-enterprise.ts` + puerto `src/aplicacion/datos` + tipos `src/dominio/datos` + composición `src/composicion/datos.ts`, con prueba vitest. Nota: la prueba pgTAP asume base sin datos (como las demás); no se volvió a correr tras sembrar la demo.

## Vistas
| Vista | Ruta | Datos | Notas |
|---|---|---|---|
| V1 Kárdex consolidado | `/inventario/kardex` | `inventario_kardex_consolidado` | Bloques Entradas / Salidas / Existencias (cantidad, valor unitario, valor total), saldo inicial como primera fila con fecha de inicio, pie de totales del filtro completo, pestañas por tipo con conteo, filtros marca/modelo/sabor/fechas/texto, 200 por página en servidor, 6 KPI, comprobación de dos vías y de periodo (inicial + entradas − salidas = final), gráficas de existencia, salidas por semana y costo promedio tras cada entrada, CSV de todo el filtro (`/inventario/kardex/exportar`). |
| V2 Kárdex por sabor | `/inventario/kardex/sabor` | igual, con `p_sku` | Existencias del sabor en cantidad, costo del modelo y **valor a costo del modelo** (piezas del sabor × costo promedio del modelo en ese movimiento; la base no guarda costo por sabor). Ratios: existencia, % del modelo, cobertura, última entrada y salida. |
| V3 Inventario por modelo y sabor | `/inventario` | `inventario_completo` + `inventario_detalle` | Una tabla con grupo colapsable por modelo (subtotal en la fila del modelo), 15 columnas (piezas, apartadas, disponibles, costo unitario, valor, % del inventario, entradas, salidas, rotación, cobertura, semáforo, antigüedad, último movimiento), pie de totales, pestañas Existencias/Compras/Documentos/Sin movimientos, chips de semáforo, "cero o negativa" y "con apartado", 6 KPI y ratios, cobertura, valor por marca, antigüedad y mapa de calor. CSV en `/inventario/csv`. |
| V4 Valuación al detalle | `/contabilidad/valuacion` | `conta_valuacion_detalle` | Activo por renglón (inventario por marca, fondos, cuentas por cobrar por cliente, socios, Omar, otros, saldos a favor), deudas por renglón, cascada valuación → utilidad, identidades I-1/I-2 y cuadre de renglones contra la valuación. Fecha de corte. |
| V4 Historial | `/contabilidad/valuacion/historial` | `conta_valuacion_serie` | Corte mensual o semanal, valuación inicial/final, cambio, % de crecimiento (Sin dato si no hay corte anterior positivo), utilidad, deudas, diferencia. Último corte marcado parcial. |
| V5 Caja y liquidez | `/contabilidad/caja` | `caja_resumen` | Entradas/salidas, saldo por lugar o persona (cuentas 1101, 1102, 1150, 1160), liquidez L01/L02, pago semanal L03/L04, series diaria y semanal. Sin movimientos de fondos: Sin dato. |
| V6 Libro de ingresos y egresos | `/movimientos/libro` | `libro_dinero` | UNA tabla: Fecha, Concepto, Categoría, Cuenta, Contraparte, Folio, Cargos, Abonos, Saldo corrido, Estado, Origen. Paginación y totales en servidor (sin tope de 200), grupo por mes con subtotales y saldo, filtros de fecha/estado/cuenta/monto/texto, orden, CSV completo. |
| V7 Marcas y proveedores | `/inventario/marcas` | `inventario_resumen_marca` | Piezas, valor, costo promedio, %, cobertura media, rotación, entradas/salidas, última entrada, proveedor más reciente (Sin dato si no hay lista de costos) y cuenta con cada proveedor. |
| V8 Mermas y diferencias | `/inventario/mermas` | `inventario_mermas` | Merma y ajustes de conteo por mes y modelo, con motivo y autor. La base no distingue falla de pérdida; no se inventa. |
| V8 Antigüedad y rotación | `/inventario/antiguedad` | `inventario_completo` + `inventario_detalle` | Tramos 0-30/31-60/61-90/+90 por última entrada (no PEPS), días sin salida, rotación, cobertura. |
| Conteo físico | `/inventario/conteo` | existentes | Encabezado v2 y resumen; la hoja ciega no cambió. |

## Cómo coinciden las cifras con el Excel
El kárdex reproduce la estructura de KARDEX IPLAY (E/S/Ex con cantidad, unitario y total; salida al promedio anterior; promedio móvil) con saldo corrido, y su existencia final coincide con `existencia_modelo` (comprobación visible). La valuación se descompone en el mismo orden que VALUACIÓN (inventario, liquidez, por cobrar, deudas, diferencia, utilidad) con una sola definición de cuentas por cobrar y una sola utilidad. El libro suma cargos y abonos como INGRESOSEGRESOS y su saldo final es el último saldo corrido. No se heredan los errores de la sección 5 de la paridad: sin costos en fórmulas, sin rangos fijos, existencia por sabor y por modelo con comprobación, fechas validadas por la base, dato ausente = Sin dato.

## Pendientes
- Conteo de efectivo por denominación y su tabla (no hay modelo en la base).
- Resumen por destino/cliente (`/inventario/kardex/destinos`) y pedidos sugeridos por sabor con costo (V8): sin función de lectura todavía.
- Consignación o reserva por tercero y proveedores distintos de Isaac y Karen (restricción `catalogo.proveedor`).
- Tarjeta-fila móvil: las tablas anchas scrollean dentro de su contenedor con primera columna fija; las cifras de la derecha quedan tras el scroll en 390.
- La prueba pgTAP con datos de caja reales (fondos con asientos) no se cubrió; se verificó a ojo con la demo (L01 cuadra con la suma por cuenta).
- No se corrió el e2e de Playwright (`f3b-inventario.spec.ts`); se conservaron sus `data-testid` y textos (`inv-valor`, `kardex-comprobacion`, `kardex-exportar`, filas "Urge pedir", "Entrada de compra", enlace "Por reponer").
- Enlaces nuevos en los subnav de Contabilidad y Movimientos (una línea cada uno): pueden chocar al fusionar con A3.

## Compartido (commits "compartido:")
`formatearDecimal` en `src/dominio/formato`; margen del eje Y de `ColumnasPeriodo` y `AreaSerie` (52 px) y ancho de etiquetas del `MapaCalor` (176 px). Estilos propios en `src/ui/estilos/paginas-a2.css`.
