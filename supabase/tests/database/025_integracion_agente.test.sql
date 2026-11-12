-- pgTAP integracion 3: agente de Telegram (reclamos, presupuesto de IA, botones de un solo uso, escrituras por indicacion) y latido. Ids de Telegram sinteticos.
begin;
select no_plan();

select agente.registrar_miembro(5000001, 'angelo');
select agente.registrar_miembro(5000002, 'javier');
select agente.registrar_miembro(5000003, 'omar');
select agente.registrar_chat('grupo_socios', -100200);
select agente.registrar_chat('privado_omar', 5000003);
select is((agente.miembro_por_telegram(5000003) ->> 'rol'), 'omar', 'Omar es rol omar');
select is(agente.miembro_por_telegram(999), null::jsonb, 'un id ajeno no es miembro');
select is((agente.chats() ->> 'grupoSocios')::bigint, -100200::bigint, 'el grupo de socios viene de la configuracion');
select is((select telegram_chat_id from notificacion.destino where clave = 'grupo_socios'), -100200::bigint, 'y alimenta el destino de las notificaciones');
select throws_ok($$ select agente.registrar_miembro(1, 'otro') $$, '23514', null, 'persona desconocida');

-- Reclamo por update_id y por mensaje
select is(agente.reclamar_update(77), true, 'el primer update se reclama');
select is(agente.reclamar_update(77), false, 'el mismo update no se ejecuta dos veces');
select is(agente.reclamar_mensaje(-100200, 5), true, 'el primer mensaje se reclama');
select is(agente.reclamar_mensaje(-100200, 5), false, 'un reenvio con otro update_id no se vuelve a ejecutar');

-- Presupuesto: cifras a mano. Tope dia 1,000,000; texto 550,000; resumen 50,000 reservado.
select is((agente.reservar('r1', 'texto', 500000, '2026-11-10') ->> 'ok')::boolean, true, 'reserva de 0.50 en texto');
select is((agente.reservar('r1', 'texto', 500000, '2026-11-10') ->> 'ok')::boolean, true, 'la misma clave no reserva dos veces');
select is((agente.presupuesto_estado() ->> 'dia_micro')::bigint, 500000::bigint, 'comprometido 500,000');
select is((agente.reservar('r2', 'texto', 100000, '2026-11-10') ->> 'motivo'), 'tope_rol', 'texto pasa de su reparto de 550,000');
select is((agente.reservar('r3', 'vision', 250000, '2026-11-10') ->> 'ok')::boolean, true, 'vision cabe');
select is((agente.reservar('r4', 'redaccion', 100000, '2026-11-10') -> 'avisos'), '["alerta_dia"]'::jsonb, 'redaccion cabe (850,000) y cruza el 80 % del dia: alerta una sola vez');
select is((agente.reservar('r5', 'resumen', 50000, '2026-11-10') ->> 'ok')::boolean, true, 'el resumen usa su propia reserva');
select is((agente.reservar('r6', 'audio', 0, '2026-11-10') ->> 'motivo'), 'monto_invalido', 'monto invalido');
select is((agente.liquidar('r1', 120000, 'modelo-sintetico', 100, 50) -> 'avisos'), '[]'::jsonb, 'liquidar con el costo real, bajo del umbral');
select is((agente.presupuesto_estado() ->> 'dia_micro')::bigint, 520000::bigint, 'comprometido = 120,000 real + 250,000 + 100,000 + 50,000');
select is((select costo_usd_micro from ia.llamada where reserva_clave = 'r1'), 120000::bigint, 'el libro de llamadas guarda el costo real');
select agente.liberar('r3');
select is((agente.presupuesto_estado() ->> 'dia_micro')::bigint, 270000::bigint, 'liberar devuelve la reserva');
select is((agente.reservar('r7', 'texto', 400000, '2026-11-10') ->> 'ok')::boolean, true, 'ahora cabe 0.40 mas (120+400 = 520 <= 550)');
select is((agente.reservar('r8', 'vision', 250000, '2026-11-10') -> 'avisos'), '[]'::jsonb, 'la alerta del dia no se repite');
select is((agente.reservar('r9', 'audio', 10000, '2026-11-11') ->> 'ok')::boolean, true, 'otro dia reinicia el dia');
select is((agente.presupuesto_estado() ->> 'dia_micro')::bigint, 10000::bigint, 'el dia nuevo empieza en cero');
select is((agente.presupuesto_estado() ->> 'mes_micro')::bigint, 930000::bigint, 'el mes sigue acumulando');
select is(agente.fijar_modo_sin_ia(true, 'tope'), true, 'modo sin IA cambia');
select is(agente.fijar_modo_sin_ia(true, 'tope'), false, 'repetir no cambia');

-- Botones de un solo uso
select agente.token_emitir('Ab12Cd34Ef', 'autorizar_toma', array['socio'], -100200, now() + interval '72 hours', 'toma:T-1', '{"folio":"T-1"}');
select agente.token_emitir('Zz98Yy76Xx', 'rechazar_toma', array['socio'], -100200, now() + interval '72 hours', 'toma:T-1', '{"folio":"T-1"}');
select is(agente.token_consumir('Ab12Cd34Ef', 'omar', -100200, now()) ->> 'estado', 'no_autorizado', 'Omar no puede pulsar');
select is(agente.token_consumir('Ab12Cd34Ef', 'socio', -999, now()) ->> 'estado', 'chat_distinto', 'tarjeta reenviada a otro chat');
select is(agente.token_consumir('Ab12Cd34Ef', 'socio', -100200, now() + interval '73 hours') ->> 'estado', 'caducado', 'caduca a las 72 horas');
select is(agente.token_consumir('Ab12Cd34Ef', 'socio', -100200, now()) ->> 'estado', 'ok', 'un socio en el grupo correcto: ok (y los intentos no autorizados no lo consumieron)');
select is(agente.token_consumir('Ab12Cd34Ef', 'socio', -100200, now()) ->> 'estado', 'usado', 'un solo uso');
select is(agente.token_consumir('Zz98Yy76Xx', 'socio', -100200, now()) ->> 'estado', 'usado', 'Autorizar invalida a Rechazar (grupo exclusivo)');
select is(agente.token_consumir('NoExiste01', 'socio', -100200, now()) ->> 'estado', 'invalido', 'token inexistente');
select throws_ok($$ select agente.token_emitir('x' || repeat('y', 70), 'otro', array['socio'], 1, now(), null, '{}') $$, '23514', null, 'el token no pasa de 64 bytes');

-- Escrituras por indicacion de un socio: con eco, canal telegram, idempotentes
select is((agente.ejecutar('tg:g1', 'gasto', '{"pagado_por":"javier","monto_cent":9000,"categoria":"uber","origen":"mensaje de prueba"}') ->> 'folio') is not null, true, 'un gasto de Javier se registra');
select is((select canal from operacion.evento where clave_idem = 'tg:g1'), 'telegram', 'el evento queda con canal telegram');
select is((agente.ejecutar('tg:g1', 'gasto', '{"pagado_por":"javier","monto_cent":9000,"categoria":"uber","origen":"mensaje de prueba"}') ->> 'gasto_id')::bigint, (select id from operacion.gasto order by id desc limit 1), 'el mismo mensaje no duplica');
select throws_ok($$ select agente.ejecutar('tg:g2', 'gasto', '{"pagado_por":"sociedad","monto_cent":9000,"categoria":"uber"}') $$, 'P0460', null, 'gasto de caja sin socio pide aclarar');
select throws_ok($$ select agente.ejecutar('tg:p1', 'pedido', '{}') $$, 'P0460', null, 'lo que aun no soporta se rechaza con claro motivo');
select is((agente.ejecutar('tg:a1', 'aportacion', '{"socio":"angelo","monto_cent":100000,"concepto":"prueba","autor":"angelo","origen":"prueba"}') ->> 'eco') is not null, true, 'aportacion con eco');
select set_config('rtm.canal', '', true);
select throws_ok($$ select operacion.registrar_gasto_socio('x', 'Javier', 100, 'uber') $$, '42501', null, 'fuera de agente.ejecutar la marca de canal no existe: nadie escribe por este camino');

-- Deshacer y tomas de Omar
select is((agente.localizar((select folio from operacion.gasto order by id desc limit 1)) ->> 'tipo'), 'gasto', 'el ultimo hecho del agente es el gasto');
select is((agente.deshacer('tg:d1', (agente.localizar((select folio from operacion.gasto order by id desc limit 1)) ->> 'folio')) ->> 'deshecho')::boolean, true, 'deshacer un gasto con su contramovimiento');
select is((select count(*)::int from operacion.gasto_anulacion where gasto_id = (select id from operacion.gasto order by id desc limit 1)), 1, 'el gasto queda anulado');
select throws_ok($$ select agente.deshacer('tg:d2', 'G-9999999') $$, 'P0460', null, 'folio desconocido');
select catalogo.asegurar_cliente('Ag Omar Persona', 'Javier');
select catalogo.asegurar_persona_bodega('Ag Omar Persona', 'Ag Omar Persona');
select catalogo.asegurar_modelo('Ag Marca', 'Ag Modelo 10K', 10000, 'ambas');
select catalogo.asegurar_sku('Ag Modelo 10K', 'Sandia');
select catalogo.fijar_costo('ag:k', 'Isaac', 'Ag Modelo 10K', 10000, negocio.hoy() - 30, 'prueba');
select catalogo.fijar_precio('ag:p', 'Ag Omar Persona', 'Ag Modelo 10K', 15000, negocio.hoy() - 30, 'chat');
select operacion.registrar_movimiento('ag:m', 'Ag Modelo 10K', 'Sandia', 'bodega_omar', 'entrada_compra', 30, 300000, negocio.hoy() - 1);
create function pg_temp.ids() returns jsonb language sql as $$ select jsonb_build_object('modelo_id', (select id from catalogo.modelo where nombre_canonico = 'Ag Modelo 10K'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Sandia'), 'piezas', 3) $$;
select is((agente.ejecutar('tg:t1', 'toma_omar', pg_temp.ids()) ->> 'estado'), 'pendiente', 'la solicitud de Omar nace pendiente: no mueve kardex ni saldo');
select is((select count(*)::int from operacion.reserva where origen_tipo = 'toma_omar' and estado = 'activa'), 1, 'con reserva activa');
select is((agente.ejecutar('tg:t1', 'toma_omar', pg_temp.ids()) ->> 'repetido')::boolean, true, 'el mismo mensaje no duplica la toma');
select is((agente.resolver_toma('tg:t1a', (select folio from operacion.toma_omar order by id desc limit 1), 'autorizar') ->> 'estado'), 'autorizada', 'un socio autoriza');
select throws_ok($$ select agente.resolver_toma('tg:t1b', (select folio from operacion.toma_omar order by id desc limit 1), 'rechazar') $$, 'P0428', null, 'la segunda decision ya no aplica');
select is(agente.resolver_toma('tg:t0', 'T-9999999', 'autorizar') ->> 'estado', 'no_encontrada', 'folio de toma inexistente');
select is(jsonb_array_length(agente.catalogo_modelos()) >= 1, true, 'catalogo de modelos para resolver alias');
select is((agente.consulta('inventario', (select id from catalogo.modelo where nombre_canonico = 'Ag Modelo 10K')) -> 'lineas' -> 0 ->> 'piezas')::int, 27, 'consulta de existencia: 30 menos 3 de la toma');

-- Latido: ejecucion una vez por ventana
select is(notificacion.sembrar_programacion('[{"tarea":"latido","expresionLocal":"cada 5 min","expresionUtc":"*/5 * * * *","descripcion":"d"}]'), 1, 'se siembra la programacion');
select is(notificacion.reclamar_ejecucion('latido', '2026-11-16T12:00'), true, 'la primera corrida de la ventana la reclama');
select is(notificacion.reclamar_ejecucion('latido', '2026-11-16T12:00'), false, 'la segunda no');
select is(notificacion.reclamar_ejecucion('desconocida', 'v'), false, 'una tarea sin programar no corre');
select notificacion.terminar_ejecucion('latido', '2026-11-16T12:00', 'ok');
select is((select estado from notificacion.ejecucion where tarea = 'latido'), 'ok', 'queda ok');
update seguridad.interruptor set activo = true where clave = 'cron_pausado';
select is(notificacion.reclamar_ejecucion('latido', '2026-11-16T12:05'), false, 'con cron_pausado nada corre');

-- Permisos
select is(has_function_privilege('authenticated', 'agente.reclamar_update(bigint)', 'EXECUTE'), false, 'la web no ejecuta el agente');
select is(has_function_privilege('servidor', 'agente.reclamar_update(bigint)', 'EXECUTE'), true, 'el servidor si');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'agente' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada');
select * from finish();
rollback;
