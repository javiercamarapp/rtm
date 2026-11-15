# Runbook de despliegue del bot de Telegram (rama bot/integracion)

Regla de costos: **0 builds de Vercel** (Vercel sin Git; se compila en la Mac con `npm run desplegar`, ver `docs/DESPLIEGUE.md`). Un push a GitHub no despliega nada. Este runbook NO se ejecuta desde la rama: cada paso lo autoriza y corre Javier. Todo lo del bot nace apagado.

## 0. Antes de mergear: colision de migraciones con main

`main` tiene tres migraciones con el mismo prefijo de version que otras de esta rama (`20261116100000_alias_waka_modelos`, `20261116100100_fotos_por_confirmar`, `20261116200000_avisos_autolimpieza`). Supabase exige versiones unicas, asi que esta rama renombro las suyas a `20261116100010_frenos_escritura_interruptor`, `20261116100110_frenos_antiduplicado_exceso_eco` y `20261116200010_agente_conversacion` (mismo orden relativo). El merge no tiene conflictos de texto, pero `avisos_autolimpieza` (main) y `emision_unificada`/`reloj_base_datos` (esta rama) redefinen funciones de notificacion (`operacion.avisar`, `notificacion.latido`): **despues de mergear, aplicar todas las migraciones en una base temporal y correr los pgTAP del bot y de avisos antes de desplegar.**

## 1. Migraciones pendientes (en orden)

Comparar contra la nube con `supabase migration list --linked` (solo lectura). Lo que esta rama agrega sobre main, en orden de aplicacion:

| Version | Migracion |
|---|---|
| 20261116100010 | `frenos_escritura_interruptor` |
| 20261116100110 | `frenos_antiduplicado_exceso_eco` |
| 20261116100200 | `frenos_deshacer_10_minutos` |
| 20261116100300 | `frenos_webhook_lease_migracion` |
| 20261116200010 | `agente_conversacion` |
| 20261116200100 | `folio_pedido_iniciales` |
| 20261116200200 | `resumen_pedido_registrado` |
| 20261116300000 | `ventas_bot_guias_catalogo_cerrado` |
| 20261116300100 | `ventas_bot_puertas` |
| 20261116300200 | `ventas_bot_lecturas_conversacion` |
| 20261116400000 | `socios_gastos_puertas` |
| 20261116500000 | `aprendizaje_tablas` |
| 20261116500100 | `aprendizaje_alias_sabores` |
| 20261116500200 | `aprendizaje_contexto_jerga_ejemplos` |
| 20261116500300 | `alta_asistida_bot` |
| 20261116500400 | `recargo_credito_semanal` |
| 20261116600000 | `reloj_base_datos` |
| 20261116600100 | `cola_vaciado_reglas_emision` |
| 20261116600200 | `rep_funciones_reportes` |
| 20261116600300 | `evaluadores_reglas_latido` |
| 20261116700000 | `cobranza_base_estado_digest` |
| 20261116700100 | `cobranza_reloj_responder` |
| 20261116800000 | `avisos_inventario_base` |
| 20261116800100 | `avisos_inventario_evaluadores` |
| 20261116800200 | `avisos_inventario_digest_consultas` |
| 20261116900000 | `emision_unificada` |
| 20261117000000 | `cierre_bot_cobro_candados_rls` |

`20261117000000_cierre_bot_cobro_candados_rls` corrige los hallazgos de la revision independiente (cobro al pedido elegido, candados antiduplicado y sobrepago, cobro sin cliente, freno de anomalias, RLS de avisos de inventario). Todas son aditivas o `create or replace`; el analizador de `desplegar.mjs` aborta ante DROP o RENAME destructivos: las migraciones de frenos usan `alter function ... rename` de funciones internas, que el analizador puede marcar; en ese caso se revisa a mano y solo con orden expresa se usa `--permitir-destructivas`. El respaldo cifrado previo lo hace el flujo oficial.

## 2. Orden de operaciones

1. `npm run desplegar:probar` (compuerta local y analisis de migraciones; no toca la nube).
2. `npm run desplegar -- --dry-run` y revisar el plan: cuantas migraciones, 0 builds.
3. `npm run desplegar` (respaldo previo, migraciones, build local, humo contra URL unica, alias, humo contra alias). Si algo falla despues del alias, restaura el alias anterior; las migraciones no se revierten.
4. Variables privadas en el entorno de produccion (nunca en el repo ni en el chat): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_MIEMBROS`, `TELEGRAM_WEBHOOK_SECRET`, `OPENROUTER_API_KEY`, `TAREAS_SECRETO`. Guia paso a paso en `docs/guia-telegram-agente.md` ("Encender el bot real").
5. Registrar miembros y chats: `npm run agente:registrar -- --dry-run`, despues sin `--dry-run` con `SERVIDOR_DATABASE_URL` de la base correcta.
6. Vaciar la cola historica de notificaciones antes de cualquier envio:
   `DATABASE_URL=... node scripts/notificaciones/vaciar-pendientes.mjs --verificar` y, si queda algo, `--aplicar`.
7. `setWebhook` con `secret_token` (variables del shell, sin historial).
8. Prueba en un grupo de prueba (ver `docs/bot-telegram-operacion.md`, paso 1 de encendido).

## 3. Scripts a correr con `--verificar` primero

Todos aceptan `--verificar` (solo lectura) y escriben solo con `--aplicar`; correr cada uno contra la base elegida con `DATABASE_URL` y revisar la salida antes de aplicar. Solo los que correspondan a migraciones ya desplegadas:

- `scripts/notificaciones/vaciar-pendientes.mjs` (antes de dejar `telegram_envio` encendido).
- `scripts/cargador/plazo-pendiente.mjs` (fecha de pago de pedidos enviados sin plazo).
- `scripts/cargador/corregir-precios-por-modelo.mjs --datos <archivo privado>`.
- `scripts/catalogo/unificar-aprobados.mjs`, luego `scripts/catalogo/fusionar-repetidos.mjs`, y `scripts/catalogo/atar-marcas.mjs`.
- `scripts/costos/cargar-mes.mjs --mes AAAA-MM`.

## 4. Que NO activar en este despliegue

Todos quedan en `false` en `seguridad.interruptor`: `agente_escritura`, `telegram_envio` (hasta vaciar la cola), `reloj_activo`, `reloj_http`, `reglas_automaticas` y cada `regla_*`, `cobranza_activa`, `avisos_inventario`, `lectura_proveedores`, `correo_envio`, `cron_pausado` (como esta), `agente_conversacion_reloj`. No ejecutar `reloj.encender()`. No dar `/escritura` en el grupo real hasta pasar la prueba del grupo de prueba. El orden de encendido esta en `docs/bot-telegram-operacion.md`.

## 5. Despues del despliegue

- `npm run humo -- https://rtm-nu.vercel.app`.
- Confirmar con SQL de solo lectura que los interruptores siguen apagados y que `select agente.escritura_estado();` dice solo lectura.
- Rotar token y secreto si alguna vez se pegaron en un chat.
- Reportar builds de Vercel provocados (esperado 0) y despliegues.
