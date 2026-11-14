# Pago de renta de la bodega de Omar

Rama `feat/pago-renta`. Migracion aditiva `20261114100000_pago_renta.sql`. Pedido del dueno (14-nov): la renta SI aplica, 2 pesos por pieza enviada desde la bodega.

## Como estaba modelado (no cambia)

- Devengo: `operacion.renta_devengo` (una fila por linea enviada, reversas en negativo). Asiento: debe 6110 Renta de bodega, haber 2210 Renta por pagar a Omar.
- Compensacion semanal con las tomas de Omar: `operacion.liquidacion_omar` (debe 2210, haber 1220).
- Pagos: `operacion.pago_omar` (`a_omar` baja la 2210 y entra al libro de socios como reembolso, nunca como capital).
- Estado de resultados: la renta YA salia separada como renglon `6110 Renta de bodega (Omar)` dentro de gastos variables. No se toco; la prueba pgTAP y el e2e lo verifican.

## Definicion unica de "por pagar"

`por pagar = devengado - compensado con tomas - pagado a Omar` = saldo de la cuenta 2210. Sin tomas liquidadas es exactamente `2 x piezas enviadas - pagos` (480 piezas => 960.00; pago de 400.00 => 560.00). Un saldo negativo es anticipo a favor de Omar.

## Superficies

| Pieza | Quien | Que |
|---|---|---|
| `api.pago_renta_panel(p_hoy)` | socio | estado, proyeccion, serie diaria, pagos con socio, nota y comprobante |
| `api.registrar_pago_renta(...)` | socio (escribe) | envuelve `operacion.registrar_pago_omar`: idempotente, fecha no futura, nota y comprobante opcionales, regla de exceso |
| `omar.mi_pago_renta()` | omar (lee) | lo mismo sin socios, notas, comprobantes, pedidos, clientes ni contabilidad |
| `operacion.renta_*` | interno | una sola definicion de cada cifra; sin EXECUTE para anon, authenticated ni PUBLIC |

GRANT: solo `EXECUTE` a `authenticated` en las tres funciones de arriba; cada una valida el rol dentro. Nada a `anon` ni `PUBLIC`.

## Decisiones

- Exceso: un pago mayor que lo que se debe NO se registra sin `p_confirmo_exceso = true` (P0428 con el monto que si se debe). Confirmado, el exceso queda anotado y la cuenta queda a favor de Omar.
- Proyeccion (siempre "Estimado"): ritmo diario de los ultimos 28 dias cerrados, rango de 10 % a 90 %. Muestra minima: 5 dias con envio y 40 piezas; con menos no se emite y la pantalla dice cuanta muestra falta. Sin tarifa tampoco.
- La web no calcula dinero: las cifras vienen de la base; en TypeScript puro solo se agrupa por dia, semana y mes, se calculan estadisticas de piezas y se redactan frases con plantilla (`src/dominio/pago-renta/calculos.ts`, pruebas en `test/unit/pago-renta`).
- Para Omar no se muestra quien pago ni la nota; solo fecha, monto, via y folio del pago.

## Archivos compartidos tocados (una linea cada uno)

`src/ui/shell/armazon.tsx` (entrada "Pago renta" del menu del socio), `src/ui/omar/armazon-omar.tsx` y su prueba (entrada en el menu de Omar, al final), `src/aplicacion/operacion/puertos.ts` (accion `registrar_pago_renta` en su propio renglon).
