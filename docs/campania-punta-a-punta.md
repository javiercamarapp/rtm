# Campaña de punta a punta (ejecución, 11-nov-2026)

Rama `integracion/ola-b1` (desde 1ce2994). Todo local: Supabase propio (`project_id` rtm-integra, puertos 55420 a 55429), aplicación en el puerto 3420 (`APP_URL_E2E`), Mailpit local, datos 100 % sintéticos (`QA PaP ...`, `E2E F2 ...`, `@example.test`). Sin Vercel, sin Supabase en la nube, sin push.

## Cómo se corrió

Un solo navegador a la vez (`workers: 1`), carga de la Mac vigilada (picos de 15 a 21 por otros procesos; nunca pasó de 40). La base se reinicia (`supabase db reset`) antes de los flujos F00 a F13 y antes de pgTAP: los hechos de negocio son de solo inserción y F10 (cierre del reparto) y F3a (cierre) no pueden correr dos veces sobre la misma base (el acta se traslapa).

Orden de la pasada final: existentes en laptop, reinicio, flujos, límites y permisos, pantallas y botones en laptop, iPhone 16 Pro (402x874), plegable cerrado (344x880), plegable abierto (880x860), existentes móviles. Temas claro y oscuro dentro de cada especificación.

## Conteos de la pasada final (pasan / fallan / pendientes)

| Tanda | Laptop 1440 | iPhone 402x874 | Plegable 344x880 | Plegable 880x860 |
|---|---|---|---|---|
| Existentes: acceso, confirmar, f1, f2, f3a | 28 / 0 / 0 | n/a | n/a | n/a |
| Existentes móviles: movil, movil-f2, movil-f3a, confirmar | n/a | 12 / 0 / 2 (n/a por tamaño) | 14 / 0 / 0 | 14 / 0 / 0 |
| Flujos F00 a F13 + invariantes + tema oscuro | 16 / 0 / 0 | n/a | n/a | n/a |
| Límites (T01 a T16, M-06) | 14 / 0 / 1 (H-33) | n/a | n/a | n/a |
| Permisos (25 rutas protegidas, un solo negocio, Omar, intrusos) | 32 / 0 / 0 | n/a | n/a | n/a |
| Pantallas (25 rutas + 3 públicas, 2 temas) y botones | 85 / 0 / 2 (n/a: menú móvil y plegado) | 86 / 0 / 1 (n/a: plegado) | 87 / 0 / 0 | 86 / 0 / 1 (n/a: menú móvil, a 880 px la barra es fija) |
| vitest completo | 1,175 pasan, 2 `it.fails` (G1 y G3 del oráculo, pendientes de decisión del dueño) | | | |
| pgTAP (`supabase test db`, base reiniciada) | 1,338 pruebas en 31 archivos: PASS | | | |

"Pendiente" aquí significa omitida por no aplicar al tamaño o marcada con motivo; ninguna prueba se borró. Las pruebas de límites de la fila 4 pasan 14 de 15 y la restante es el pendiente H-33.

Comprobaciones de código con los cambios: `tsc`, `eslint`, guardas (0 violaciones), escáner de secretos (0 hallazgos).

## Bugs reales encontrados y corregidos (commits `fix(...)`)

1. **Corte de red tiraba toda la pantalla** (`src/app/(socio)/operacion/usar-accion.ts`): si la respuesta de una acción de servidor se perdía, la excepción de la transición mostraba "No se pudo cargar esta pantalla" y se perdía el diálogo. Ahora el diálogo muestra un aviso y el reintento manda la misma clave de idempotencia. Regresión: límites T05(c).
2. **Foco de los diálogos** (`src/ui/componentes/confirm-dialog.tsx`): React no escribe `autofocus` y `showModal()` enfocaba el primer campo; el diálogo se desmonta al cerrar y el foco se perdía. Ahora abre en Cancelar y devuelve el foco al control de origen. Regresión: límites T10.
3. **Orden inestable de Cuentas por cobrar** (migración nueva `20261111007000_cxc_orden_estable.sql`): los pedidos con los mismos días salían en distinto orden en cada lectura (dos socios veían filas distintas). Se desempata por `pedido_id`. Regresión: permisos "un solo negocio".
4. **Monto "9,5" leído como $95.00** (`src/dominio/dinero.ts`): la coma se borraba. Ahora solo vale como separador de miles; "9,5" y "1.234,56" se rechazan. Regresión: vitest H-29 (antes `it.fails`) y e2e T02.
5. **Menú móvil quedaba abierto** (`src/ui/shell/armazon.tsx`): tocar el enlace de la página actual no cambia la ruta y el menú seguía tapando el contenido.
6. **Cajón "Explicar este número" se reabría** (`src/ui/componentes/explicar.tsx`): cerrarlo mientras cargaba y recibir la respuesta lo reabría y le quitaba el foco al botón de origen. Ahora la respuesta tardía se descarta y el foco vuelve aunque la pantalla se haya repintado.
7. **Cifra del pulso de 25 px de alto en pantallas táctiles** (`src/ui/estilos/shell.css`): ahora 44 px.

## Errores de la prueba (corregidos sin debilitarla)

- Selector `main` doble durante la carga (pantalla de carga más página); ahora `main:not(.rtm-documento)`.
- `entrarComo` volvía antes de abrir sesión cuando el destino era `/` (el patrón `**/**` coincidía con la propia página de confirmación).
- F01 cambiaba el precio del cliente de los flujos (retroactividad prohibida por el SQL); ahora lo hace en un segundo cliente.
- F05: el recargo sugerido es 10 % del subtotal de mercancía (600.00), no del saldo (135.00); la entrega de un socio se mide en su saldo total (la interfaz registra `general`).
- F08: la regla de fondeo (primero la caja de la empresa) exige saldo en caja; la prueba le da un saldo inicial sintético.
- F09: la devolución automática de capital ya no existe (retiro de capital explícito); la prueba verifica que el formulario no la ofrece y que el SQL responde `P0428`.
- Guías, etiquetas y textos únicos por corrida (la base acumula entre corridas); esperas con `expect.poll` donde el efecto es asíncrono.
- Textos vigentes: "Falta: motivo", "Continuar con correo", "Te mandamos un enlace a tu correo", testids `efectivo-calculado` y `campo-p_dias`, cliente sin "(Angelo)" en el selector (sin dueño), `semana-anterior` antes de proponer el cierre.
- Pruebas con `test.fail` que ya pasan (H-15, H-17, H-32, H-53) pasaron a definitivas; H-30 se resolvió por diseño (la cascada ya no acepta una caja tecleada).
- Campos de 16 px y objetivos de 44 px se exigen por debajo de 1024 px y el menú móvil por debajo de 768 px (límites reales de `shell.css`).
- WebKit: esperas de navegación suave y se ignoran solo tres señales exactas de precarga RSC cancelada ("Load failed", "Failed to fetch RSC payload ... Falling back to browser navigation" y "due to access control checks"); Next se recupera solo y la persona no ve nada. Quedó 1 intermitencia en 3 corridas antes del filtro.
- Pantallas y botones pasaron de modo serial a independiente para que un fallo no oculte el resto.

## Pendientes por no estar construido o por decisión del dueño

- **H-33** (lectura que falla muestra "No se pudo cargar"): `test.fixme`. `error.tsx` existe, pero la simulación por ruta devuelve texto plano y no llega al límite de error; falta un mecanismo para fallar una lectura `api.*` en la base de prueba.
- **vitest G1 y G3** (retiro previo y pérdida arrastrada del oráculo): `it.fails`, dependen de las reglas A a F del dueño.
- **pgTAP 990** (24 bloques `ESPERADO-FALLA-HASTA`): defectos SQL conocidos sin corregir (GD-01 guía costeada después de la nota, GD-05 mensaje crudo de P0423, GD-25 signo del movimiento, GD-15 anulación de prepago aplicado, GD-16 y GD-17 sobrante y faltante, H-27 tope de 15 piezas de la toma, CP02, GD-09, CP24 cancelar empacado, GD-07 merma). Dos aserciones ya salen `TODO passed` (6 y 9): moverlas a su archivo definitivo.
- Concurrencia real (G18, G19, T12), comandos de Telegram CP07 a CP23, devolución parcial y paquete perdido: no existen las funciones o requieren dos conexiones (ver `test/e2e/LEEME-punta-a-punta.md`).
- Contabilidad (Diario, Mayor, Estados, Proyecciones): la construye otro agente en `~/rtm`; no hay pruebas todavía.
- Sin revisar a ojo en esta campaña: contraste, huecos y desbordes se midieron por código (`contrasteDeTextos`, `huecosMuertos`, `sinScrollHorizontal`, 0 hallazgos en las 25 rutas y 4 tamaños); la revisión humana de las capturas (tanda 6) queda para el dueño.

## Capturas

238 PNG (claro y oscuro, cuatro tamaños) en `/private/tmp/claude-501/-Users-javiercamaraportepetit/8387d844-0acc-4e47-8b08-6746be09ac0c/scratchpad/capturas-campania/` (fuera del repo; el original es `test-results/punta-a-punta/`, ignorado por git). Muestra pequeña en `docs/capturas/campania/`. Reportes de cada tanda: `.../scratchpad/res/final/*.log`.

## Para repetirla

```
supabase db reset   # antes de los flujos y de pgTAP
APP_URL_E2E=http://127.0.0.1:3420 npx playwright test --config playwright.punta-a-punta.config.ts --project=laptop-1440 punta_a_punta_flujos
```

`APP_URL_E2E` evita chocar con el puerto 3100; el `supabase/config.toml` con puertos propios no se versiona.
