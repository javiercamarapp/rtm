# Autolimpieza de avisos

Pedido del dueño (14-nov): los avisos se borran cuando se solucionan o se atienden los temas; solo siguen si sigue la causa.

## Cómo funciona

- `notificacion.condicion(aviso)` evalúa la misma regla que generó el aviso sobre el estado de hoy. Devuelve la clase (`condicion`, `informativo` o `externo`), si sigue vigente, el motivo y una referencia al hecho que lo resolvió.
- `notificacion.depurar(aplicar)` recorre los avisos abiertos. Si la causa ya no existe: estado `resuelta`, canal `sistema`, motivo "resuelto solo: la causa desaparecio (...)", referencia y fecha. Es idempotente. Con `aplicar = false` solo informa.
- Nada se borra: el aviso queda en la base y en el historial; la página lo muestra en **Resueltos recientes** (14 días, parámetro `aviso_resueltos_recientes_dias`).
- Reabrir: si la causa reaparece, el aviso se reabre sin duplicar. Dos caminos: el emisor vuelve a emitir con la misma huella (`operacion.avisar` reabre un aviso cerrado por el sistema) o el barrido detecta la causa de nuevo (`notificacion.reabrir`). Solo se reabre lo cerrado por el sistema; lo descartado o cerrado por una persona se respeta. Al reabrir vuelve a figurar sin leer y no se reenvía por Telegram.
- Cuándo corre: (1) al abrir `/avisos` y la campana (`api.depurar_avisos`), (2) en cada pulso del latido (`notificacion.latido`), (3) por el script. No hay `pg_cron` en el repo; el patrón vigente es el latido.
- Además la bandeja filtra en vivo: contadores (Sin leer, Críticas, Importantes, Piden una acción), Tu turno y las listas muestran solo avisos cuya condición no es falsa, aunque el barrido no haya corrido.
- Informativos sin causa: se retiran (estado `caducada`, motivo "retirado: ...") cuando los leyeron todos los destinatarios o a los **7 días** (`aviso_info_retiro_dias`). Los críticos sin regla nunca se retiran por edad.
- Sin topes ni confirmaciones nuevas. Todo es SQL; el modelo de IA no calcula nada.

## Tabla aviso, condición vigente, cómo se resuelve

| Aviso (código) | Sigue mientras | Se resuelve cuando | Referencia |
|---|---|---|---|
| conteo_con_diferencia | hay una línea con diferencia sin explicar que ningún conteo posterior de la ubicación confirmó (cuadre en cero del SKU) | todas las diferencias quedaron explicadas o un conteo posterior las confirmó | conteo posterior |
| pedido_enviado_con_excepcion | el pedido sigue enviado, algún precio aceptado sigue distinto del tabulador, bajo costo o sin precio de catálogo (según la última nota) y tiene saldo por cobrar | se corrigió la nota, se cobró por completo (`aviso_excepcion_cierra_al_cobrar`) o el pedido se anuló | nota o aplicación de pago |
| pieza_no_llego_saldo | el cliente tiene saldo a favor (saldo del cliente < 0) | el saldo se aplicó o se devolvió | pedido |
| paquete_por_empacar | pedido confirmado y sin empacar | se empacó, envió o canceló | pedido |
| sabor_faltante_antes_empacar | pedido sin empacar y existencia en Bodega Omar menor a lo pedido | hay existencia o ya no espera empaque | pedido |
| llegada_pendiente_confirmar | compra en estado `llego_merida` | se confirmó la recepción | compra |
| diferencia_recepcion_abierta | diferencia sin responsable asignado vigente | se asignó responsable | asignación |
| pago_sin_identificar | pago `sin_identificar` sin identificación | se identificó | identificación |
| cascada_lista_firma, utilidad_mayor_que_efectivo | cierre de reparto no anulado con menos de dos firmas | firmaron los dos socios o se anuló | firma o anulación |
| retiro_capital_por_confirmar | retiro sin confirmación del otro socio | se confirmó | confirmación |
| toma_pendiente | toma de Omar en estado `pendiente` | se autorizó, rechazó o caducó | toma |
| toma_sin_precio | toma pendiente o autorizada sin precio | se fijó precio o dejó de estar vigente | toma |
| cobranza_vence_manana | pedido enviado con saldo por cobrar | saldo en cero | aplicación de pago |
| fondos_en_poder_socio | días de fondos en poder del socio mayores a `fondos_alerta_dias` (7) | bajó del plazo | socio |
| paquete_incidente_reportado | incidente sin responsable y efecto registrados | se resolvió | incidente |
| saldo_negativo_karen | saldo con la proveedora negativo | deja de ser negativo | proveedor |
| tarea_falla | la última corrida de la tarea terminó en error | una corrida posterior terminó bien | ejecución |
| telegram_entrega_muerta | la entrega sigue muerta y no salió nada después al mismo destino | Telegram volvió a entregar | entrega |
| comprobacion_dinero_falla, cuenta_proveedor_no_cuadra | los resuelve `notificacion.evaluar` (corre en el latido) cuando la comprobación cuadra | cuadra | comprobación |
| pago_posible_duplicado y cualquier aviso que pide acción y no tiene regla aquí | clase `externo`: lo cierra una persona con su botón o su emisor; el barrido no lo toca | botón | no aplica |
| Informativos: paquete_enviado_con_guia, guia_registrada_trayecto, oc_confirmada_dinero_aplicado, nota_corregida_o_anulada, periodo_cascada_cerrado, saldo_proveedor_cruza_cero, posicion_socios_cambia, usuario_alta_o_rol, accion_fuerte_o_periodo, paquete_incidente_resuelto, freno_tormenta y los tipos del catálogo sin acción | no tienen causa persistente | leídos por todos o 7 días | no aplica |

Los avisos que ya se cerraban por evento (`operacion.resolver_avisos`, llamado por pagos, recepciones, envíos, firmas) siguen igual y ahora también guardan motivo.

## Parámetros (`catalogo.config`)

- `aviso_info_retiro_dias` = 7
- `aviso_resueltos_recientes_dias` = 14
- `aviso_excepcion_cierra_al_cobrar` = 1 (con 0, un pedido enviado aceptando avisos sigue mientras el precio no se corrija aunque ya esté cobrado)

## Página

`/avisos`: por omisión **Vigentes**; filtros Sin leer y Resueltos recientes (con motivo, fecha y referencia); contadores calculados en la base sobre todo lo vigente. La pestaña Todas de la campana muestra solo vigentes.

## Script

```
node scripts/notificaciones/resolver-vigentes.mjs --verificar   # lista lo que se resolvería; no escribe
node scripts/notificaciones/resolver-vigentes.mjs --aplicar     # lo resuelve
```

Conexión: `RTM_DB_URL` o la base local de `supabase status`. Nunca imprime la cadena de conexión. Es idempotente.

## Decisiones y pendientes

- Una diferencia de conteo no puede explicarse después de cerrar (`conteo_linea` es de solo inserción): hoy solo se cierra con un conteo posterior que cuadre. Si el dueño quiere poder explicarla después, falta una tabla de explicaciones.
- Un aviso reabierto no se reenvía por Telegram (solo reaparece en la campana).
- `api.avisos_lista` (lo usa el agente) no se tocó: sigue listando por estado.
- Aplicar la migración en producción y correr el script con `--verificar` primero queda a cargo del dueño.
