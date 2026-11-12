# Rediseño etapa 2, lote A3: informe

Rama `rediseno/pag-a3` (desde `rediseno/premium` 4d4db8d). Sin push, sin builds de Vercel, sin despliegues. Datos de las capturas: fixtures y demos ilustrativos en un Supabase local propio (proyecto `rtm-a3`, puertos 583xx; su `config.toml` local no se versiona).

## Qué se hizo, por página (datos: lectores existentes `operacionDeSocio` y `contabilidadDeSocio`; solo la serie semanal es nueva)
- `/cuentas-por-cobrar`: 5 KPI (total con barra de antigüedad, vencido, por vencer, clientes, saldos a favor), razones (antigüedad media ponderada, recargo aplicado y sugerido, sin plazo, pagos sin identificar, fondos en poder de socios), antigüedad apilada por cliente, concentración con acumulado, próximos vencimientos, estado del plazo, recargo, fondos por socio; tabla densa por pedido/cliente/a favor/sin identificar/socios con pie de totales, búsqueda y CSV. Pendiente: no hay serie histórica de cartera (la base no la expone).
- `/proveedores`, `/proveedores/liquidacion`, `/proveedores/compras/[id]`: KPI, cascada de la hoja semanal, saldo corrido (magnitud, el signo va en el dato), pagos por concepto, compras por estado, comprobaciones por dos vías, conciliación, tablas densas.
- `/socios`, `/socios/[socio]`, `/socios/cascada`: aportado/puesto/fuera de sociedad, posición neta, fondos, libro, cascada de reparto, resultado por socio, cierres. Solo presentación: ningún cálculo de reparto cambió. Pendiente: historial personal y acta de corte (adendas 31-33) no tienen datos.
- `/omar`: KPI, razones, cascada, renta por modelo y por semana, tablas por pestañas, CSV. Sin costos, márgenes ni clientes.
- `/contabilidad` (tablero), diario, mayor (por tipo y por cuenta), estado de resultados (comparativo contra periodo anterior, % de ingresos), balance (comparativo a 7 días), flujo, comprobaciones y proyecciones (flujo a 4 semanas con rango, utilidad proyectada, cobertura del viernes, sensibilidad al costo; todo «Estimado»/«Escenario»; con menos de 6 semanas completas dice «No se estima»). Pendiente: punto de reorden por modelo (requiere ventas semanales por modelo; estado vacío honesto).

## Migración nueva
`20261112300000_a3_conta_serie_semanal.sql`: `api.conta_serie_semanal(p_semanas)`, solo lectura, reutiliza `estado_resultados` y `flujo_efectivo`, grant solo a `authenticated` y exige rol socio. pgTAP `a3_001_conta_serie_semanal.test.sql` (12 pruebas, verde). Acceso `src/infra/supabase/contabilidad-serie.ts` con prueba `test/unit/contabilidad_serie.test.ts`.

## Archivos propios
`src/app/(socio)/_a3/` (utilidades, serie, envolturas cliente de gráficas en pesos), `src/ui/estilos/paginas-a3.css`, capturas `docs/capturas/rediseno-a3/` (manifest.md), `test/capturas/a3.spec.ts`, `playwright.capturas-a3.config.ts`, `scripts/capturas/datos-demo-a3.mjs`. No se tocó ningún componente compartido (cero commits «compartido:»).

## Verificación
tsc, eslint y guardas en 0; vitest 74 archivos, 1285 pruebas verdes; pgTAP del lote verde. Capturas 1440 y 390, claro y oscuro, de 21 pantallas, sin errores de página y sin scroll horizontal de página en móvil (las tablas anchas desplazan dentro de su contenedor).
No se corrió: e2e de Playwright de F3a/F3b ni el pgTAP completo (se conservaron los data-testid que buscan). Los asientos manuales del demo A3 descuadran auxiliares: solo para ver series.

## Notas
- Los totales de pie suman columnas de filas ya entregadas por la base; no hay reglas de dinero nuevas.
- Las gráficas reciben centavos y rotulan el eje en pesos mediante envolturas cliente.
- Pendiente de capturas: tarjeta-fila móvil (no existe en el catálogo), diálogos abiertos.
