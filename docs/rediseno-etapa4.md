# Rediseno, etapa 4: lo que solo existe en main

Rama `rediseno/premium`, worktree `~/rtm-rediseno`. Datos ilustrativos solamente (Supabase local propio `rtm-e3`, puertos 583xx). Sin push, sin Vercel, sin nube: 0 builds y 0 despliegues.

## 1. Fusion de main

Commit `d89a505` (`git merge --no-ff`, conservando ambos lados). En los conflictos se mantuvo la version rediseñada y se portaron las funciones de main:

- Catalogo: boton "Editar costos de Isaac y Karen". Proveedores: enlace "Inventario actual de proveedores".
- Clientes: "Nuevo cliente", y en la ficha "Editar precios", "Editar cliente" y "Nuevo pedido"; origen con `etiquetaOrigen`.
- Cuentas por cobrar: tabla de saldos de apertura.
- Socios: "Mi desglose", desglose por socio con selector, cascada sin caja tecleada (utilidad acumulada, efectivo calculado, retiros ya recibidos, contra-acta y actas).
- Layout con `premium.css` y `omar.css`. Playwright: `E2E_PUERTO` y `APP_URL_E2E`.
- La guarda nueva de main (sin `flex: a b Npx` fuera de selectores de fila) obligo a corregir `paginas-a1.css`, `paginas-a2.css` y `premium.css`.

## 2. Paginas rediseñadas

Mismo lenguaje que las etapas 1 a 3: Geist, tokens, componentes del catalogo (`Pagina`, `Tarjeta`, `Rejilla`, `KpiLinea`, `BarList`, `DataTable`, `Aviso`, `Chip`, `Segmentado`), tablas que caben, sin huecos verticales, tarjeta-fila en movil, sin emojis. Se conservaron todos los `data-testid`.

| Pagina | Notas |
|---|---|
| Movimientos (bandeja, resumen, importar) | KPI, pestañas por estado, tabla a todo el ancho, paginacion; resumen con `Segmentado` por dimension; importador con ensayo y formato |
| Apertura (resumen y diez pasos) | KPI de activo, pasivo, capital y puente; lista de pasos; cada paso con su vista previa, huella y firmas |
| Contactos | KPI (total, con correo, con colonia, sin lada), filtros en linea, tabla densa con telefono enmascarado, revelar y exportar, barras por origen y anuncio |
| Clientes nuevo, editar y precios | Formulario en tarjeta, tabulador vigente e historial en tablas densas |
| Catalogo, costos de Isaac y Karen | Tabla vigente, formulario con vigencia, historial |
| Costos del sistema | KPI mensuales, tarjetas por servicio, cargos, cuenta con Javier, formularios |
| Proveedores: inventario actual y orden de compra | Estado de la lectura, lista para clientes, promociones, cola y eventos |
| Reportes y vista previa | Preparar, historial con estado en palabra y color, marco del reporte |
| Vista de Omar (mi bodega, mi cuenta, paquetes) | Sin costos, margenes, clientes ni contactos (tampoco en los tipos). KPI de cuenta, tablas densas, tarjeta-fila movil |
| Desglose de socio, hoja de conteo fisico, campana de avisos, carga de contactos | Tarjetas v2, hoja en rejilla de columnas, panel de la campana con el borde y la severidad del sistema |

## 3. Commits (sin squash)

- `d89a505` merge de main
- `0e2dbf1` movimientos y apertura
- `f3effab` contactos
- `7fbd793` clientes, costos, inventario de proveedores, compra, reportes y Omar
- `fb1d401` hoja de conteo, desglose, campana, carga de contactos
- `bc8072e`, `0260529` capturas de etapa 4, tablas a todo el ancho, demo de contactos
- los de correccion de e2e que siguen (ver `git log`)

## 4. Verificacion

- `tsc`: 0 errores. `eslint`: 0. Guardas estaticas: 0 violaciones. `npm run secretos`: 0 hallazgos.
- `vitest`: 112 archivos, 1713 pruebas en verde (2 fallos esperados).
- Playwright con instancia propia (`E2E_PUERTO=3105`, Supabase local propio reseteado): corrida completa 106 de 113 en verde; los 5 fallos de pantallas de esta etapa (texto del ensayo del importador, campo de 16 px en movil, region de estado del inventario de proveedores) se corrigieron y sus pruebas pasan al repetirlas (costos, inventario de proveedores, apertura y movimientos en las tres vistas moviles). Queda `acceso.spec.ts` prueba 4 (limite de correos del login: llegan 4 en lugar de 3 en el correo local), que solo usa el login y no se toco; no se comparo contra main.
- Capturas en `docs/capturas/rediseno-etapa4/` (1440, 1280 y 390; claro y oscuro; Omar a 1440 y 390) y metricas en `m-*.txt`. Las metricas TABLA, HUECO y SCROLLH quedaron en cero tras corregir: bandeja de movimientos y contactos pasaron a tabla de ancho completo con las tarjetas laterales debajo; Sesiones de apertura y las tarjetas del resumen usan alineacion al inicio. Las lineas COLA corresponden a paginas cortas (formularios) y no son huecos.

## 5. Pendiente

- Historial personal (acta de corte y valuacion por socio): la pagina no existe en main; no hay nada que rediseñar todavia.
- Los subnavs de movimientos, apertura, inventario y contabilidad siguen con `rtm-subnav` (aceptable; se pueden pasar a `Pestanas` en una etapa de pulido).
- Los datos demo `datos-demo-f3b.mjs` y `datos-demo-f3b-inventario.mjs` fallan con las reglas nuevas de main (apertura manual prohibida, permisos); por eso las capturas de contabilidad profunda no se rehicieron en esta etapa.
- Vista previa de reportes con datos reales y paginas de reportes con versiones multiples: solo se capturo el estado vacio o de una version.
- Contactos con 9,228 registros no se probo; la demo usa 60 contactos inventados.
