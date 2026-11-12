# Campaña de punta a punta: orden de ejecución y datos de demostración

Estado: TODO está escrito y tipado (`tsc`, `eslint` y `playwright --list` limpios) pero NO se ejecutó nada contra base ni navegador: quien lo corra puede encontrar selectores o códigos de error que ajustar. Un fallo de una prueba no marcada como pendiente es o hallazgo o ajuste de la prueba; revisar el código antes de decidir.

Reglas de la campaña: un solo proceso pesado a la vez (Mac cargada), `workers: 1`, tiempo de espera de 90 s, solo local (Supabase local con Mailpit, sin Vercel, sin Supabase en la nube, sin Telegram, sin push). Datos 100 % sintéticos (`QA PaP ...`, `E2E F2 ...`, correos `@example.test`).

## Qué hay

| Capa | Archivos | Casos |
|---|---|---|
| pgTAP (`supabase/tests/database/`) | `901` a `908` (definitivas), `990_pendientes_de_correccion` | 422 + 31 |
| vitest (`test/unit/punta_a_punta/`) | `dinero_entre_socios`, `economia_pedido`, `monto_formularios`, `transversales` y el oráculo `oraculo.ts` | 85 (3 `it.fails`) |
| Playwright (`test/e2e/punta_a_punta_*.spec.ts`, configuración `playwright.punta-a-punta.config.ts`) | `flujos`, `pantallas`, `botones`, `limites`, `permisos` | 150 en laptop, 87 en cada uno de los 3 móviles |

Pruebas pendientes de corrección (no rompen el verificar):
- pgTAP `990`: 24 bloques `todo_start('ESPERADO-FALLA-HASTA: ...')` con 30 aserciones. Salen como `not ok ... # TODO`; cuando el defecto se corrija salen como `# TODO passed`: mover esa prueba a su archivo definitivo y quitar el todo.
- vitest: `it.fails` (G1, G3 del oráculo y H-29 de `9,5`). Cuando se corrija, el `it.fails` pasa a rojo: quitarlo.
- Playwright: `test.fail(true, ...)` en H-15, H-17, H-29, H-30, H-32, H-33 y H-53. Igual: al corregirse, la prueba "falla" y hay que quitar la marca.

## Preparación (una vez)

1. `main` limpio; decidir si entra la rama `ajuste/sin-division-por-duenio` (cambia H-17 y las pruebas de espacios muertos).
2. `npm run db:iniciar` y comprobar `supabase status` (3 a 6 min).
3. `npx next build` y `npx next start -p 3100` en una terminal aparte (4 a 7 min). Reconstruir solo si cambia `src/`.
4. Verificar `http://127.0.0.1:3100/api/health`.
5. Dar al contenedor de Docker al menos 6 GB; cerrar apps ajenas. Si la carga pasa de 8 o aparece swap, pausar entre tandas.

## Tandas (de lo barato a lo caro; detenerse al primer rojo de una capa)

| Tanda | Comando | Qué valida | Tiempo (Mac cargada) |
|---|---|---|---|
| 1a | `npm run typecheck && npm run lint && npm run guardas && npm run secretos` | tipos, reglas, ningún dato real | 5 a 8 min |
| 1b | `npx vitest run test/unit/punta_a_punta test/contratos` | dinero, montos, calendario, rutas | 1 min |
| 1c | `npm run db:probar` | los 14 archivos existentes + `901` a `908` + `990` | 10 a 14 min |
| 2 | `npx playwright test --config playwright.punta-a-punta.config.ts --project laptop-1440 punta_a_punta_flujos` | F00 a F13 en serie + invariantes + tema oscuro | 25 a 40 min |
| 3a | `... --project laptop-1440 punta_a_punta_limites punta_a_punta_permisos` | T01, T02, T04, T05, T10, T13, T15, T16, T07 | 20 a 30 min |
| 3b | `... --project laptop-1440 punta_a_punta_pantallas punta_a_punta_botones` | 25 rutas y todos los botones en claro y oscuro con capturas | 25 a 40 min |
| 4 | `... --project iphone-16-pro`, luego `--project fold-cerrado`, luego `--project fold-abierto` (uno por vez; esperar a que baje la carga) | pantallas y botones en 402x874, 344x880 y 880x860 | 15 a 25 min cada uno |
| 5 | Invariantes: ya van dentro de la tanda 2 (prueba `INVARIANTES`) y de `908`. Para repetirlos aparte: `supabase test db` solo con `908_inventario_e_invariantes` | cadena de auditoría, existencias, reversas únicas, socios por dos vías | 2 min |
| 6 | Revisión humana de las capturas de `test-results/punta-a-punta/` (laptop y iPhone, claro y oscuro) y consolidación | H-42 a H-52 (espacios muertos), H-53 a H-61 (contraste) | 30 a 45 min |

Las capturas quedan en `test-results/punta-a-punta/<proyecto>__<tema>__<nombre>.png` (carpeta ignorada por git).

## Datos de demostración por flujo

Todos se siembran dentro de la propia especificación (`beforeAll`) con sufijo propio por corrida; los hechos de negocio son de solo inserción, así que `npm run verificar` reinicia la base antes y después.

| Flujo | Siembra | Qué necesita |
|---|---|---|
| F00 acceso | ninguna | correos `@example.test` y Mailpit |
| F01 a F13 | `sembrarFlujosQA()` (`punta_a_punta_ayudas.ts`) | modelo con Fresa y Uva; 100 + 100 piezas a costo puesto 102.25 (20,450.00); Isaac 100.00; Karen 110.00 supuesto; cliente con precio 150.00; persona de bodega. Los flujos son ACUMULATIVOS: F02 deja 400 piezas, F04 crea P-1, F05 la cobra, F06 crea P-2 y la OC-2, F11 anula P-2. Correrlos en orden y en una sola pasada |
| F07 | semilla de F2 (existencias) | renta de 2.00 por pieza (configuración `renta_por_pieza_cent`) |
| F10 | semana anterior con movimientos | el recorrido propone el cierre de la semana anterior; el segundo socio firma desde otra sesión |
| F13 | saldo de Isaac y OC-1/OC-2 de F02 y F06 | el botón de cerrar solo se habilita el viernes: la prueba lo comprueba deshabilitado cualquier otro día |
| `pantallas`, `botones`, `limites`, `permisos` | `sembrarQA()` | semilla de cuentas de F3a (`sembrarCuentasE2E`: pedidos de bodega, vencido y directo, toma de Omar, saldo a favor con Karen) más una OC en borrador a Karen y un pedido confirmado |

## Qué no se pudo escribir o queda para quien ejecute

- Concurrencia real (G18, G19, T12): requiere dos sesiones de base (`dblink` o dos clientes `pg`); un solo script pgTAP corre en una transacción. Pendiente de escribir como prueba de integración (`test/integracion`) con dos conexiones.
- GD-20 (saldo anterior encadenado en la liquidación de Isaac), GD-10 (anulación en tránsito), devolución parcial y paquete perdido (no existen las funciones), tope de 15 piezas por mensaje del agente, comandos de Telegram (`CP07` a `CP23`): no hay forma de probarlos sin el agente o sin las funciones.
- T11 (reloj inyectado) a nivel SQL solo se cubre con fechas fijas; `negocio.hoy()` no se puede sustituir desde pgTAP sin tocar código de producción.
- Mapa de contraste de `tokens.css` (H-53 a H-61) como prueba de cálculo puro: lo cubre en vivo `contrasteDeTextos` y `contrasteDeBordesDeCampo` de `punta_a_punta_ayudas.ts`; falta el contrato estático sobre `tokens.css`.
- El ejemplo "8,639.50" ya está cubierto: es 17,279.00 / 2 (utilidad 20,000.00 menos gastos de Javier 2,221.00 y de Angelo 500.00); ver `906_socios_dorados.test.sql` y `dinero_entre_socios.test.ts`.
