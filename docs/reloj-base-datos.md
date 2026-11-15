# Reloj en la base de datos, cola de envios, reglas y reportes programados

Estado de origen (decision del dueno, 14-nov): TODO construido y APAGADO. Hoy no hay reloj en produccion y `telegram_envio` esta encendido; nada de lo de abajo se enciende solo.

## Piezas

| Pieza | Donde | Estado de origen |
|---|---|---|
| Reloj (pg_cron + pg_net) | esquema `reloj` (migracion 20261116600000) | extensiones solo si estan disponibles; 2 jobs creados y DESACTIVADOS |
| Cola: vaciado de historicas | `notificacion.vaciar_pendientes`, `scripts/notificaciones/vaciar-pendientes.mjs` | sin ejecutar |
| Reglas con interruptor propio | `notificacion.regla` + `seguridad.interruptor` (`regla_*`) | todas apagadas; maestro `reglas_automaticas` apagado |
| Emision programada | `notificacion.emitir_programado` | techo 6 al dia, silencio 21:00 a 07:00 (Merida) salvo criticos, deduplicacion por clave, enfriamiento por clase |
| Cifras | `agente.rep_*` (solo servidor) | solo lectura |
| Plantillas | `src/dominio/agente/reportes_programados.ts` | puras: solo dan formato |
| Tareas | `resumen-diario` (20:00) y `pendientes-diarios` (09:00) en `src/config/tareas.ts` | omitidas mientras su regla este apagada |

## Reloj

* Job `rtm_reloj_latido` (`*/5 * * * *`): `reloj.tick()`. Siempre cuenta (`reloj.contador.ejecuciones`) y deja una fila en `reloj.latido`. **Latido sin enviar**: con `reloj_http` apagado no habla con nadie.
* Con `reloj_http` encendido pide `GET <catalogo.config reloj_url_latido>` (la app, `/api/tareas/latido`) con el secreto `TAREAS_SECRETO` leido del Vault (nombre en `reloj_vault_secreto`). El reloj no envia mensajes de Telegram: los despacha la app.
* Reintento: `reloj.reintentar` repite SOLO si la respuesta registrada en `net._http_response` no es 2xx (o vencio el tiempo), hasta `reloj_reintentos_max`. Sin respuesta registrada NO reenvia (pudo haber salido): marca `sin_respuesta` y avisa una vez.
* Reloj caido: `reloj.verificar` (job `rtm_reloj_vigia`, `*/15`, y tambien cada latido de la app: segundo mecanismo). Con `reloj_activo` encendido y sin latido en `reloj_tolerancia_min` (15) emite `tarea_sin_latido` (NT-103, critico), una vez por caida, solo si la regla `reloj_caido` esta encendida; al volver el latido se resuelve solo.

### Encender (en este orden; cada paso lo autoriza el dueno)

1. Vaciar la cola historica: `node scripts/notificaciones/vaciar-pendientes.mjs --verificar` y luego `--aplicar` (contra la base elegida con `DATABASE_URL`). Debe quedar en cero antes de dejar `telegram_envio` encendido.
2. Guardar el secreto en el Vault (`select vault.create_secret('<valor>', 'reloj_tareas_secreto')`, nunca en el repo) y fijar la URL: fila nueva de `reloj_url_latido` en `catalogo.config` (cerrar la anterior).
3. `select reloj.preparar_extensiones(); select reloj.encender();` (activa interruptor `reloj_activo` y los jobs). Observar 3 latidos con `select reloj.estado();` sin enviar nada.
4. `update seguridad.interruptor set activo = true where clave = 'reloj_http';` solo despues de revisar los latidos.
5. Reglas: `select notificacion.fijar_regla('resumen_diario', true);` (una por una) y al final `update seguridad.interruptor set activo = true where clave = 'reglas_automaticas';`. Encender fija `activa_desde`: una regla solo emite hechos POSTERIORES a su activacion.

### Apagar

`select reloj.apagar();` (apaga `reloj_activo`, `reloj_http` y desactiva los jobs). Para cortar todo mensaje programado de inmediato: `update seguridad.interruptor set activo = false where clave = 'reglas_automaticas';`.

## Reglas (todas apagadas)

`resumen_diario`, `pendientes_diarios`, `cobertura_pagos` (cruce de >= 1.0 a < 1.0), `vencimiento_proveedor` (3, 1 y 0 dias y el dia siguiente; Isaac plazo 7, Karen plazo 10; el pago se aplica FIFO: lo pendiente son las obligaciones mas recientes), `cobranza_vence_manana`, `cuenta_vencida` (dia 1 y cruces de 8, 15, 30 y 60 dias), `libro_no_cuadra` (C1..C24 y CU, solo el paso de verde a rojo), `reloj_caido`, `fondos_en_poder` (solo si crecen), `margen_bajo` (menor al 5 por ciento por pedido; excluye pedidos a costo del socio), `credito_sin_plazo` (solo software) y `diferencia_recepcion_vieja` (7, 14 y 30 dias).

Cada regla tiene su interruptor (`regla_<nombre>`) y el maestro `reglas_automaticas`. Un cambio de verde a rojo o un cruce que ya existia al encender la regla NO se avisa (queda visible en el resumen).

## Definiciones de las cifras

* Cobertura de pagos = cobrable hasta la fecha de pago / pagable a proveedores (en centesimas: 118 = 1.18). Fecha de pago = proximo vencimiento de proveedor; cobrable = saldos de clientes que vencen a mas tardar ese dia (incluye lo ya vencido). Tambien se informa sin el cliente mayor.
* Vencimientos de proveedor: obligaciones = compras de la sociedad y pedidos de dropshipping enviados (sin los pedidos a costo del socio); lo que el libro dice que se debe se asigna a las mas recientes (equivale a pagar primero lo mas viejo).
* Margen = (venta - costo surtido - seguro) / venta, en puntos base, calculado por SQL.
