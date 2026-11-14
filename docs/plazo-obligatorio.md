# Plazo obligatorio en pedidos a credito y renta de Omar en Por pagar

Rama `feat/plazo-obligatorio-y-renta-por-pagar`. Decisiones del dueno (14-nov). Migraciones aditivas `20261114700000` y `20261114700100`.

## (A) Todo pedido a credito exige plazo

Convencion: `operacion.pedido.plazo_dias` son los dias para pagar contados desde el ENVIO (vencimiento de Cuentas por cobrar = `fecha_envio + plazo_dias`). **0 = de contado.** Al crear ya no se acepta NULL: error `P0436` con texto claro ("el pedido necesita plazo: indica en cuantos dias paga el cliente, o 0 si es de contado"); plazo fuera de 0 a 365 tambien es `P0436`.

| Ruta que crea pedido | Guarda |
|---|---|
| Web `api.crear_pedido` | exige `p_plazo_dias`. La pantalla de pedido pide "Condicion de pago" (de contado / a credito + dias) y no deja crear sin ella. |
| Bot (`agente.ejecutar_ext`, `pedido_crear`) | exige `plazo_dias` y lo fija con `operacion.acordar_plazo` (queda el evento `plazo_acordado`). El bot PREGUNTA antes de escribir ("¿es de contado o a cuantos dias paga?"); el plazo lo interpreta el codigo (`src/dominio/agente/plazo_pedido.ts`), nunca la IA. Comando: `/pedido Cliente \| modelo 24 \| plazo contado`. |
| Dropshipping `operacion.ds_crear_pedido` / `api.ds_crear_pedido` | un credito debe traer `fecha_pago` o `semanas` explicitas (antes se asumia 1 semana); `semanas = 0` se rechaza (el contado se declara como contado, sin credito). El contado fija plazo 0. La venta a costo del socio de menudeo exige fecha de pago (`p_fecha_compromiso`) y su plazo = dias hasta ella; ya no existe "sin fecha" para pedidos nuevos (web y bot insisten). Los pedidos anteriores sin fecha se cubren con el script (B). |
| Cargador historico | usa `api.crear_pedido` (lote 5) y `ds_crear_pedido`: el credito ya llevaba plazo explicito y el contado ahora se carga con plazo 0. Su carga no cambia (`scripts/cargador/plan.mjs`). |
| Importacion | no crea pedidos. |
| `operacion.crear_pedido` (interna, sin EXECUTE para la web) | no cambia: las rutas de arriba la llaman despues de validar. |

Implementacion: `operacion.exigir_plazo_pedido`, `api.crear_pedido` (create or replace), rename+wrap de `operacion.ds_crear_pedido` y de `agente._ejecutar_ext_base`.

## (B) Pedidos existentes sin plazo: fecha de pago 2026-11-20

Script `scripts/cargador/plazo-pendiente.mjs` (ver `docs/cargador.md`, seccion "Plazo pendiente"). Escribe solo por `api.acordar_plazo` (auditado). Los dias se cuentan desde el envio para que el vencimiento sea exactamente 2026-11-20 (el plazo vive en dias; el vencimiento de CxC suma al envio). Entran todos los enviados con saldo y sin plazo, tambien los pedidos a costo del socio sin fecha comprometida. Lo que no se puede (envio igual o posterior a la fecha) se lista y no se toca.

```
DATABASE_URL=... node scripts/cargador/plazo-pendiente.mjs --verificar
DATABASE_URL=... node scripts/cargador/plazo-pendiente.mjs --aplicar
```

### Plazo dicho como fecha en el bot

Los dias corren desde el ENVIO (vencimiento = `fecha_envio + plazo_dias`). Si el socio dice una fecha ("el viernes"), el codigo la vuelve dias desde hoy y la tarjeta lo dice: "N dias a credito, contados desde el ENVIO" y "ese dia solo vence si el pedido se envia hoy". Una negacion ("no esta pagado", "no es de contado") nunca es contado: se vuelve a preguntar.

## (C) Renta de Omar en "Por pagar"

Ver `docs/pago-renta.md`, seccion "Por pagar de la empresa". Sin asientos nuevos; sin duplicar; C1 a C24 intactas.

## Pruebas

pgTAP `a12_001` (web y dropshipping), `a12_002` (bot), `a12_003` (por pagar); vitest `test/unit/plazo_pedido.test.ts`, `por_pagar.test.ts`, `test/unit/agente/plazo_pedido.test.ts`, `agente.plazo_pedido.test.ts`.

## Pendiente de decidir (no implementado)

Recargo por atraso de credito (10 % simple por semana de atraso, por SQL): no se implemento, nada de esta rama lo contradice (el plazo y el vencimiento quedan como base).
