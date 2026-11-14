# Banner de igualación de valuación

Decisión del dueño (14-nov): "Debemos estar igualados de valuación siempre. Cuando alguien haya recibido transferencias a sus cuentas personales debe haber en Inicio un anuncio diciendo que debe reponer el dinero y cuánto es para igualar valuación."

## Qué hace

Un banner en Inicio, visible para los dos socios (Omar y la bodega no llegan a Inicio de socios; la base además exige rol socio en `api.cuenta_socios_valuacion`).

- **Socio por debajo** (`role="alert"`, rótulo textual "Acción requerida"): "Debes reponer $X para igualar valuación" con dos partidas, "Entregar a la sociedad los fondos recibidos en tu cuenta personal: $A" y "Aportar a la sociedad: $B" (B solo si existe), cada una con enlace al flujo donde se registra (`/cuentas-por-cobrar?vista=socios` para la entrega; `/socios`, "Registrar depósito de un socio", para la aportación).
- **El otro socio** (`role="status"`, rótulo "Para tu información"): "Angelo debe reponer $X para igualar valuación (entregar $A y aportar $B)", sin botones.
- **Igualados**: no se pinta nada. La tarjeta TU VALUACIÓN ya dice "Estás igualado"; una confirmación permanente en Inicio sería ruido y la base no guarda cuándo se igualaron.

## Cifras: solo SQL

Migración aditiva `20261114800000_banner_igualar_valuacion.sql`:

- `operacion.banner_igualacion(p_cuenta jsonb)` arma el bloque `banner` desde lo que ya calcula `operacion.cuenta_socios_valuacion` (campo `igualacion`). No agrega reglas de dinero; solo tolerancia, antigüedad, entregas parciales y avance.
- `api.cuenta_socios_valuacion` devuelve lo mismo de antes más `banner` (null con un corte histórico). Una sola lectura para Inicio, /socios y el bot.
- `agente.valuacion_socios` incluye `banner`.

TypeScript (`src/dominio/socios/banner-igualar.ts`) solo elige la variante y redacta; convierte `*_cent` a bigint con `centavosABigint`. El modelo de IA no interviene.

**Tolerancia**: 1 centavo (`tolerancia_cent`). El reparto 50/50 de una utilidad con centavo impar se redondea a favor de quien paga (`operacion.cap_mitad`), así que los dos pueden quedar a un centavo sin que nadie deba nada. Con `faltan_cent <= 1` el banner desaparece; `exacto` indica si la diferencia es 0.

## Semántica

- La entrega de fondos ya recibidos baja "fondos de la sociedad en su poder" y por eso sube la valuación. **No es aportación de capital.**
- La aportación B es capital únicamente si el socio lo declara; el banner no la marca. Solo informa el faltante y manda al flujo (`registrar_aportacion` exige `intencion`: reembolso o capital). El texto "Explicar este número" del banner lo dice.
- **Neteo**: identidad `X = entregar(menor) + aportar(menor) - entregar(mayor) - aportar(mayor)` (`cuadra` en el jsonb). Si el socio con más valuación también tiene fondos por entregar, el banner lo avisa ("se netean: la regla es igualar valuaciones, no cada partida") sin sumar partidas en el cliente.

## Perfeccionamientos

- **Antigüedad**: "Fondos en tu poder desde hace N días (fecha)", con `operacion.dias_fondos_en_poder` (la misma de Cuentas por cobrar).
- **Entregas parciales**: lista plegable con las entregas a la sociedad (`entrega_a_sociedad`, aplica a fondos o general, sin las reversadas) desde la fecha del cobro más viejo aún abierto.
- **Barra de avance**: entregado / (entregado + por entregar), en puntos base calculados en SQL; solo aparece si ya hay entregas. Es aproximada: toma las entregas fechadas desde el cobro abierto más antiguo.
- Animación de entrada y de la barra, desactivada con `prefers-reduced-motion`. Blanco y negro: la variante se distingue por rótulo y tipo de borde, no solo por color.
- Cifra principal con "Explicar este número" (`CifraComprobada`).

## Telegram

`mi valuación`, `como estamos` y `/valuacion` agregan la línea "Igualar valuación" con la misma frase y las mismas cifras (`fraseBannerAgente`), por ejemplo "Debes reponer $47,921.91 para igualar valuación (entregar $35,475.00 y aportar $12,446.91); los fondos están en tu cuenta personal desde hace 4 días". Sin emojis.

No existe hoy un resumen diario del agente con plantilla propia (`/resumen` responde "Eso todavía no lo consulto desde Telegram"; solo está el tipo de aviso `resumen_diario` sin productor). Cuando se construya, debe llamar a `fraseBannerAgente` con `agente.valuacion_socios()`. El comentario posterior a cada aportación (`comentarioIgualacion`) sigue basado en aportación neta y no se tocó.

## Pruebas

- vitest: `test/unit/socios/banner-igualar.test.ts` (variantes, partidas, neteo, tolerancia, lectura bigint, frase del bot), `src/ui/componentes/banner-igualar.test.tsx` (jsdom + axe, roles ARIA, enlaces), `test/unit/agente/valuacion_consulta.test.ts`.
- SQL: la lógica de `banner_igualacion` y `api.cuenta_socios_valuacion` se ejecutó en una base PostgreSQL 17 temporal con tablas de prueba mínimas (ya borrada): cifras del dueño, entrega reversada excluida, entrega anterior al cobro excluida, corte histórico en null.
- pgTAP `supabase/tests/database/a12_001_banner_igualar_valuacion.test.sql`: escrita con el escenario completo del dueño, corrida por un revisor independiente en una base limpia con la pila completa de migraciones: 27 de 27 en verde. Requiere una base recien reseteada (con datos residuales falla por cifras, no por la migracion).
- No se probó en navegador.
