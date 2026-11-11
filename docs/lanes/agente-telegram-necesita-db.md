# Lo que el agente de Telegram necesita de la base de datos

Este modulo no creo migraciones. Cada puerto de `src/aplicacion/agente/puertos.ts` necesita lo siguiente (esquema `agente` salvo que se indique; escritura solo por funciones `SECURITY DEFINER` con `search_path=''`, primera linea `seguridad.exigir_rol(...)`, parametro `p_clave_idem`, retorno `jsonb`; RLS forzada, cero privilegios, como en F1).

## Tablas

| Tabla | Para el puerto | Campos y reglas |
|---|---|---|
| `agente.miembro` | `AlmacenAgente.miembroPorTelegramId` | `telegram_user_id bigint PK`, `persona {angelo, javier, omar}`, `rol {socio, omar}`, `activo`. Omar desactivado hasta M2 |
| `agente.chat_registrado` | `AlmacenAgente.chats` | `destino {grupo_socios, privado_omar} PK`, `chat_id bigint UNIQUE`. Solo dos filas |
| `agente.tg_update` | `reclamarUpdate` | `update_id bigint PK`, `recibido_at`. `INSERT ... ON CONFLICT DO NOTHING RETURNING` (true si inserto) |
| `agente.tg_mensaje` | `reclamarMensaje` | `(chat_id, message_id) PK`. Mismo patron |
| `agente.estado` | `modoSinIa` | fila unica: `sin_ia bool`, `motivo`, `avisado bool`, `actualizado_at`. Se reinicia al cambiar el periodo de gasto o con `/conia` |
| `agente.llm_corrida` | `corrida`, `guardarCorrida` | `clave text PK` (hash de chat, mensaje, version de prompt y rol), `resultado jsonb` (el objeto validado), `modelo`, `tokens_entrada`, `tokens_salida`, `costo_micro_usd bigint`, `creada_at`. Sin texto de usuarios |
| `agente.ia_presupuesto` | `AlmacenPresupuesto` | `dia date`, `mes text`, `dia_micro bigint`, `mes_micro bigint`, `por_rol jsonb`, `alerta_dia bool`, `alerta_mes bool` (fila unica por periodo) y `agente.ia_reserva(clave text PK, rol, micro_usd bigint, estado {reservada, liquidada, liberada}, creada_at)` |
| `agente.tg_token` | `AlmacenTokens` | `token text PK` (<= 64 bytes, aleatorio), `accion`, `roles_permitidos text[]`, `chat_id bigint`, `caduca_at`, `grupo_exclusivo text NULL`, `usado_at NULL`, `payload jsonb` |
| `agente.evento` | `registrarEvento` | `id`, `tipo`, `miembro bigint NULL`, `detalle text`, `creado_at`. Sin contenido de mensajes |
| `agente.contador_no_procesado` | `contarNoProcesado` | contador por dia (aparece en el resumen de las 8 pm) |

La logica de reserva, liquidacion, liberacion y alertas es la de `src/dominio/agente/presupuesto.ts`; la funcion SQL debe dar los mismos resultados (prueba de paridad por propiedad, 500 casos, contra el oraculo de TypeScript, como manda la spec 14 sec. 2).

## Funciones (contrato de `NegocioAgente`)

Todas reciben `p_clave_idem` y devuelven el mismo resultado si se repite la clave (`repetido = true`).

- `registrar_pedido`, `registrar_pago`, `registrar_pago_proveedor` (adenda 23: liquida CxC del cliente y sube el saldo a favor con el proveedor), `registrar_gasto` y `registrar_aportacion` (adenda 21: cuenta por pagar al socio), `registrar_compra`, `generar_orden_compra` (costo vigente, aplicacion del saldo a favor primero, cuenta negativa si hay credito, Karen solo confirma con pago completo), `registrar_toma_omar` (reserva activa, folio T, sin kardex ni saldo).
- `autorizar_toma(folio, socio, autorizar)`: pendiente -> autorizada (movimiento al costo promedio y credito al precio de su lista) o rechazada (libera reserva). `caducar_tomas(ahora, horas)`: libera la reserva y devuelve los folios.
- Consultas `STABLE` que leen web, agente y PDF: existencia por modelo y sabor, saldo de cliente, de Omar, de proveedor y de socios, precio del tabulador, pendientes, resumen. Ninguna cifra la calcula el agente.
- `localizar_para_deshacer(autor, folio)`, `dependencias_de(folio)` (pagos aplicados despues, notas enviadas, movimientos posteriores) y `deshacer(folio, clave)`: inserta el contramovimiento enlazado (`corrige_folio`) con las lineas en signo contrario; idempotente.
- Las preguntas del servidor (`precio_fuera_tabulador`, `bajo_costo`, `existencia_insuficiente`, `menos_de_20_piezas`, `modelo_fuera_de_catalogo`, `monto_parecido_a_saldo`, `baja_confianza`, `falta_destino`) las decide la funcion cuando `confirmado = false`.

Referencia ejecutable de todo este contrato: `src/infra/agente/negocio_simulado.ts` y sus pruebas (`agente.negocio.test.ts`), con las cifras doradas de las adendas 21 y 23.

## Catalogo

`CatalogoAgente` lee clientes, modelos y alias (`catalogo.cliente`, `catalogo.alias_cliente`, `catalogo.modelo`, `catalogo.alias_modelo` de F1) y los sabores EN EXISTENCIA de un modelo (`operacion.existencia_sku`). Un alias compartido por dos entradas debe llegar como dos entradas con el mismo alias; el resolutor pregunta. "Karen" y "Vapemate" son un solo proveedor.

## Ninguna otra cosa

Sin extensiones nuevas, sin tablas para Omar fuera de `omar.*` (las tomas se leen con las vistas de la vista de Omar), sin `service_role` en tiempo de ejecucion.
