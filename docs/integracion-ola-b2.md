# Integracion Ola B2

Rama `integracion/ola-b2` (desde `integracion/ola-b1`). Se fusiono el commit `8e02134` de main (F3a mas asientos contables y Contabilidad, aprobados por verificacion independiente), no la rama viva. Sin push, sin Vercel, sin Supabase en la nube; no se cargo ningun dato real. Playwright no se ejecuto.

## Fusion

`git merge --no-ff 8e02134` (commit ebe62c7). Dos conflictos, ambos de lineas contiguas:

| Archivo | Resolucion |
|---|---|
| `src/dominio/acceso/ruta_segura.ts` | La lista de rutas propias conserva `mi-bodega` (integracion) y agrega `contabilidad` (main). |
| `src/ui/shell/armazon.tsx` | Se importan `IconoContactos` e `IconoContabilidad`; el sidebar conserva Contactos y Contabilidad. Mi bodega sigue siendo la vista propia de Omar (fuera del sidebar de socios). |

Sin conflicto y combinados automaticamente: `operacion.css`, `iconos.tsx`, `puertos.ts`, `playwright.config.ts`, `package.json`, `acciones.ts` y la prueba `ruta_segura.test.ts` (que ya cubre `/contabilidad`).

## Migraciones

Main aporta solo tres: `20261110001800` (f3b contabilidad base), `001900` (estados) y `002000` (resolucion de diferencias). No existen `002100` ni `002200` en `8e02134`. Las de la integracion: `20261111000100..000400` (dinero), `005000..005300` (alta y Omar), `006000` (contactos) y `007000` (orden estable de cuentas por cobrar).

- Sin versiones repetidas (`ls | cut -d_ -f1 | uniq -d` vacio).
- Orden: toda la contabilidad (2026-11-10) precede al dinero (2026-11-11). Desde cero (`supabase start` y `db reset`) las 44 aplican sin error.
- Dependencias: dinero redefine funciones de f3a (`registrar_pago_a_socio`, `registrar_aportacion`, `cascada_*`, `api.explicar_cifra`); contabilidad lee las tablas (`socio_libro`, `aportacion_socio`, `cuenta_socio_mov`, `gasto`) y no llama esas funciones, salvo el desvio de `api.explicar_cifra` (ver fix 1).

## Correcciones de integracion

1. `api.explicar_cifra` (cec0f83): la migracion `000400` de dinero la reemplazaba y delegaba en la de f2, perdiendo toda la cadena f3a y f3b (las cifras `conta:*` respondian "cifra desconocida"). Ahora renombra la de contabilidad a `explicar_cifra_f3b`, atiende primero `socios:*` y `cascada:*` y delega en `_f3b` (que delega en f3a y f2). Se edito la migracion porque no esta aplicada en ninguna base.
2. `015_f3b_asientos` GU-4 (mismo commit): registraba un retiro con `registrar_pago_a_socio`, que desde dinero exige utilidad asignada y caja de la empresa (H10). Como la prueba verifica el mapeo contable (retiro a 3210 contra 1101), siembra el evento y el renglon de `socio_libro` directamente. Ninguna asercion se debilito.
3. Hash de exencion de `login.css` (a838537): la guarda fallaba desde antes de la fusion (el campo de 16 px de la rama de integracion cambio el archivo); se actualizo el hash tras revisar el cambio de una linea.
4. Pruebas de contrato obsoletas por cambios ya aprobados, no por la fusion: el chip tactil de 44 px tambien aplica en `(max-width: 1023px)`, y `login.css` agrega `font-size: 16px` (se actualizaron las expresiones y los conteos de lineas, no se quito ninguna comprobacion).

## Verificaciones (estado final)

| Verificacion | Resultado |
|---|---|
| tsc --noEmit | 0 errores |
| eslint src scripts test | 0 errores |
| npm run guardas | 0 violaciones (baseline 0) |
| npm run secretos | 0 hallazgos en 1425 archivos y en el historial |
| vitest completo | 95 archivos, 1565 pasan + 3 esperados-fallo (it.fails), 0 fallos |
| supabase test db (proyecto rtm-integra2, puertos 55520-55529) | 34 archivos, 1500 pruebas, Result: PASS; 990 con 14 TODO (12 fallan a proposito, 2 "TODO passed": 6 y 9) |

El proyecto local se detuvo con `supabase stop --project-id rtm-integra2`; `supabase/config.toml` quedo identico a main (los puertos propios no se versionan).

## Pendiente: puente entre el dinero y los asientos (documentado, no inventado)

Se probo en la base local (transaccion revertida) un escenario con saldo inicial, aportacion de capital, aportacion como reembolso, gasto de empresa, gasto de socio, ajuste de conteo, traspaso y pago de reembolso, y se compararon los asientos con los movimientos.

- Cubiertos y que cuadran: aportaciones (capital 3110/3120 y reembolsable 2310/2320 contra 1101), gasto de empresa y gasto de socio, pago de reembolso y retiro de utilidad, cascada y acta (por `socio_libro`). `contabilidad.comprobaciones()` sin fallas y balance con diferencia 0.
- SIN asiento: los eventos `movimiento_efectivo` (`saldo_inicial`, `ajuste_conteo` y `traspaso` de `operacion.registrar_movimiento_efectivo`). En la prueba el efectivo operativo (`operacion.saldo_efectivo()`) fue 1,470,000 centavos y la cuenta 1101 contable 500,000: la diferencia es exactamente el saldo inicial (1,000,000) menos el ajuste (30,000). Ninguna comprobacion de contabilidad compara el efectivo operativo contra 1101, asi que el hueco no se detecta.
- Definiciones que faltan del dueño (no se inventaron): cuenta de contrapartida del saldo inicial (capital de apertura o aportacion inicial), cuenta de sobrante o faltante para el ajuste de conteo, y si el traspaso entre la caja de la empresa y el efectivo de un socio se asienta como fondos en poder del socio (1150/1160). Los datos de apertura los entrega el dueño despues de terminar el software.
- Cuando se definan: agregar el mapeo de `cuenta_efectivo_mov` por evento en `contabilidad.lineas_evento` y una comprobacion "efectivo operativo = suma de 1101, 1150 y 1160" en `contabilidad.comprobaciones()`.
- No verificados en la sonda: `retiro_capital_propuesto/confirmado`, `cierre_reparto_firmado` y `contra_acta_propuesta` con datos reales de cascada (sus pruebas pgTAP de dinero pasan; falta una de asientos).

## Otros pendientes

- Playwright completo (otro agente).
- 990: mover a su archivo definitivo las pruebas 6 y 9 (ya pasan).
- Numeracion pgTAP: hay dos archivos 015 y dos 016 (`015_contactos`, `015_dinero_socios_cascada`, `015_f3b_asientos`; `016_dinero_socios_acta`, `016_f3b_propiedad`); no chocan por nombre pero conviene renumerar.
- Carga de contactos reales a produccion: solo por el flujo de despliegue autorizado.
- Builds de Vercel provocados: 0. Despliegues: 0.
