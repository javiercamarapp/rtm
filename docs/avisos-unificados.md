# Avisos unificados (reloj, cobranza, inventario y proveedores)

Migracion de composicion: `20261116900000_emision_unificada.sql`. Todo sigue APAGADO de origen: no toca ningun interruptor.

- Una sola interfaz: `notificacion.emitir_estado(codigo, clave, payload, canal, ahora)` (jsonb) y `notificacion.emitir(...)` (bigint). Enruta por codigo: regla del reloj -> `emitir_programado`; regla de inventario -> cola `agente.aviso_cola`.
- Un solo techo: el libro `notificacion.programado` cuenta cada mensaje enviado (reporte, alerta, digest de inventario, digest de cobranza). Tope = `catalogo.config.rep_techo_diario` (6); los criticos saltan el tope y cuentan. Silencio 21:00 a 07:00 (Merida) para todos.
- Un solo digest: las ventanas M (09:00) y R (20:00) de inventario viajan DENTRO de pendientes y resumen cuando esos reportes estan encendidos (`agente.avisos_digest_armar(..., p_fusion)`). Con el reporte apagado, la ventana manda su mensaje propio.
- Cobranza: su digest sigue siendo un mensaje aparte (tarjetas con respuesta), cuenta en el mismo techo, respeta el silencio y, encendido, hace ceder las reglas `cobranza_vence_manana` y `cuenta_vencida` del reloj.
- Tareas nuevas del latido (apagadas por sus interruptores): `cobranza-reloj` y `avisos-inventario`.
- Prueba: `test/integracion/dia_completo_reloj_avisos_e2e.test.ts` (reloj simulado) y pgTAP `ig_001_emision_unificada`.
