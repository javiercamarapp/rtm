# Informe del carril telegram-agente

Rama `lane/telegram-agente` (worktree `~/rtm-lane-telegram`, base `rediseno/premium`). Sin push, sin Vercel, sin Supabase en la nube, sin Telegram ni OpenRouter reales, sin datos reales. Builds y despliegues de Vercel: 0.

## Auditoria: lo que el agente cubria y lo que faltaba

| Necesidad de los socios | Antes | Ahora |
|---|---|---|
| Gasto de socio | gasto (directo, sin resumen) | gasto con resumen y confirmacion; pregunta quien lo pago si es "sociedad" |
| Cobro a cliente | pago (solo en el simulador; la base respondia "no lo registro") | pago real via `registrar_pago`; pide la cuenta de entrada |
| Pago a proveedor | solo simulador | `pago_proveedor` en base: cliente redirigido, de un socio o de la sociedad |
| Reembolso a socio | no existia | `reembolso_socio` (`registrar_pago_a_socio`, tope = pendiente) |
| Retiro de utilidad | no existia | `retiro_utilidad` (tope = utilidad asignada, regla H10 de la base) |
| Aportacion de capital declarada | aportacion sin distinguir | campo `intencion`: capital solo si se declara; si no, reembolso; el resumen lo dice |
| Reinversion | no existia | NO por Telegram: la decide el corte mensual con acta (el agente remite al software) |
| Devolucion y paquete perdido | no existian | contrato listo (intencion, esquema, comando, resolucion, resumen, espejo en simulador); base responde P0461 hasta integrar sus ramas |
| Apertura y saldos historicos | no | NO por Telegram (sesion de apertura con revision y firma); el prompt manda "aclarar" |
| Confirmacion previa | no (eco + Deshacer) | resumen con Confirmar o Cancelar antes de registrar (`confirmarMovimientos`, por omision true) |
| Consultas | inventario, saldo cliente/proveedor/socios | agrega estado de cuenta de socio, utilidad (hoy, semana, mes) y cartera |
| Auditoria | canal telegram | ademas `agente.hecho` (folio, autor, fila) y `mensaje_origen = telegram:<persona>: <cita>` |

## Cambios

- Dominio y aplicacion: nuevas intenciones y esquema estricto, `exigeConfirmacion`, `datoFaltante`, resumen (`plantillas.resumenConfirmacion`) y boton `confirmar_resumen`; el confirmador puede ser cualquiera de los dos socios (el eco dice quien pidio y quien confirmo); Omar no puede pulsar. Prompt a `r2-2026-11-13.1` (reglas contra calcular y fuera de alcance). Prefiltro con palabras de las nuevas intenciones (antes "utilidad del mes" se ignoraba por no traer cifras).
- Comandos nuevos: `/reembolso`, `/retiro`, `/aporte ... capital`, `/devolucion`, `/paquete`, `/estado`, `/utilidad`, `/cartera`.
- Migracion `20261113100000_telegram_agente_socios.sql` (aditiva, posterior a 20261113000400): `agente.hecho`, `agente.capacidades()`, `agente.ejecutar`, `agente.localizar(folio, autor)`, `agente.deshacer` y `agente.consulta` extendidos. No redefine ninguna funcion de negocio (la rama de paquetes redefine `operacion.utilidad_periodo`; aqui solo se llama).
- Cambio de comportamiento deliberado: `agente.ejecutar` exige `autor` para todo movimiento de dinero (P0460 sin el). `agente.localizar(null)` ahora incluye aportaciones y pagos del libro del agente; se ajusto el pgTAP 025 en consecuencia.

## Resultados (comandos reales)

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit` | sin errores |
| `npx eslint` sobre agente (src y test) | sin errores |
| `vitest run test/unit/agente test/unit/omar` | 21 archivos, 376 pruebas en verde (antes de agregar los evals) |
| `vitest run test/unit test/contratos --maxWorkers=3` | 92 archivos, 1458 en verde, 2 esperadas como fallo (existentes) |
| `agente.socios.test.ts` | 33 pruebas: cada intencion, faltantes, duplicados, deshacer, confirmacion negada, montos inventados o sumados por el modelo, esquema estricto, Omar, consultas, comandos, simulador completo y 11 evals de frases |
| pgTAP 025 y 029 (base propia, puerto 56322) | 95 pruebas, "All tests successful" |
| pgTAP completo (47 archivos, 2237 pruebas) | un fallo en `024_omar_cuenta_sin_folio` test 13 ("ajuste de -60.00"): es de la cuenta de Omar, no toca el agente; no se verifico en la base sin esta rama |

No se corrio `test:integracion` (requiere el entorno del servidor) ni Playwright. La carga de la Mac estuvo en 50-110 durante toda la sesion y no bajo de 40: corri un vitest o pgTAP a la vez, con `--maxWorkers=3` en la suite amplia, y una sola base propia (proyecto `rtm-lane-tg`, puertos 563xx, `config.toml` marcado skip-worktree y no commiteado). La base propia se detuvo al terminar.

## Pendientes y decisiones para Javier

1. Integrar devolucion y paquete: cuando `lane/devolucion-parcial` y `lane/paquete-perdido` esten en la base, conectar `agente.ejecutar` (resolver folio de pedido y lineas) y `NegocioAgenteDb`; `agente.capacidades()` ya avisa.
2. Pedidos, compras y ordenes de compra siguen sin registrarse desde Telegram en la base (como antes); solo existen en el simulador.
3. Fechas pasadas y apertura: se hacen en el software; el agente registra siempre con la fecha de hoy.
4. Pago de un socio a un proveedor no tiene anulacion directa en la base: `deshacer` responde que se hace desde el software.
5. Falta una prueba de integracion de `NegocioAgenteDb` contra la base (el SQL esta probado con pgTAP y el simulador con vitest, pero el mapeo TypeScript a SQL no se corrio de punta a punta).
6. Encender el bot real: ver `docs/guia-telegram-agente.md`.
