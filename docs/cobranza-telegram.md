# Cobranza por Telegram (carril bot/cobranza)

Estado: construido, probado y APAGADO. Nada se envia a Telegram mientras el dueno no encienda los interruptores.

## Que hace

- Un solo digest diario de cobranza a las 09:00 de Merida, agrupado por cliente y por dia: aviso un dia antes, pregunta el dia del vencimiento y de +1 a +3, linea compacta desde +4 (siguen apareciendo todos los dias; solo cambia el formato) y repaso cada lunes. Cierre opcional a las 17:00 solo si algo vencia hoy sin respuesta. Sin contenido no se envia nada.
- Respuestas en lenguaje natural del socio (las interpreta el interprete como `cobranza_respuesta`): pago total o parcial, promesa de fecha, se atrasa, aun no, disputa, pausa, reanudar y extender plazo.
- Reglas: el modelo nunca calcula dinero ni fechas. El monto sale del texto del socio (con "k" o "mil" se repite y se pregunta), la fecha de "el jueves" la resuelve el codigo, y el saldo, el reparto entre pedidos, la suma de "se atrasa una semana", el recargo y los totales los pone SQL.
- Reprogramar mueve la fecha PROMETIDA, no el plazo contractual ni el recargo. Solo una extension explicita (decide el socio dueno del cliente) mueve el vencimiento efectivo y el inicio del recargo.
- El recargo (10 % simple por semana completa, `operacion.recargo_sugerido`) solo se sugiere en el digest; lo decide el dueno del cliente.
- Deshacer 10 minutos (`deshacer COB-0012`), antiduplicado por contenido (mismo cliente y monto en 10 minutos), idempotencia por clave, respuestas de solo anexar.
- Metricas y perfil por cliente (SQL; el perfil solo con 3 o mas pedidos cerrados).

## Interruptores (todos nacen apagados)

| Interruptor | Efecto |
|---|---|
| `agente_escritura` | Mientras este apagado el bot no registra respuestas de cobranza (ni nada). Lo enciende un socio con `/escritura`. |
| `cobranza_activa` | El reloj no reclama ni arma ningun digest. |
| `telegram_envio`, `cron_pausado` | Tambien frenan el reloj. |

El reloj es la funcion `cobranza.reloj_tick(tipo)` mas `ejecutarRelojCobranza` (TypeScript). No esta conectado a ninguna ruta ni programacion: quien lo invoque (latido o cron) es una decision posterior. Solo escribe al chat del grupo de los socios.

## Pruebas

- pgTAP: `cb_001_cobranza_calendario` (estado derivado, digest, simulacion del 14 al 21-nov, reloj) y `cb_002_cobranza_respuestas` (respuestas, conflictos, deshacer, metricas).
- vitest: `test/unit/agente/cobranza.*.test.ts`.
- E2E (base temporal con todas las migraciones, `RTM_DB_URL_COBRANZA`): `test/integracion/cobranza_e2e.test.ts`.
