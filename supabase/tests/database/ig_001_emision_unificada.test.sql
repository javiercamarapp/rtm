-- pgTAP de la INTEGRACION de avisos (reloj + cobranza + inventario): todo apagado de origen, interfaz unica notificacion.emitir, techo unico de 6, cesion de cobranza y fusion de digest.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);

-- 1. Todo nace apagado
select is((select count(*)::int from seguridad.interruptor where activo and (clave like 'regla\_%' or clave in ('reglas_automaticas', 'reloj_activo', 'reloj_http', 'avisos_inventario', 'cobranza_activa', 'telegram_envio', 'reloj_transporte_simulado'))), 0, 'ningun interruptor de los tres carriles nace encendido');
select is((select count(*)::int from agente.aviso_regla where activo), 0, 'ninguna regla de inventario nace activa');
select is((select count(*)::int from reloj.job where activo), 0, 'ningun job del reloj nace activo');
select is((select count(*)::int from notificacion.regla r where not exists (select 1 from seguridad.interruptor i where i.clave = r.interruptor)), 0, 'toda regla del reloj tiene su interruptor propio');

-- 2. Interfaz unica: enruta por codigo; apagado no sale nada
select is(notificacion.emitir_estado('resumen_diario', 'ig:k0', '{"texto":"x"}')  ->> 'estado', 'apagada', 'reloj: regla apagada no emite');
select is(notificacion.emitir_estado('inv_agotado', 'ig:k1', '{}') ->> 'estado', 'omitida', 'inventario: interruptor apagado no encola');
select throws_ok($$select notificacion.emitir_estado('no_existe', 'ig:k', '{}')$$, '22023', null, 'codigo desconocido se rechaza');
select throws_ok($$select notificacion.emitir_estado('resumen_diario', 'ig:k', '{}')$$, '22023', null, 'el aviso del reloj exige texto');

-- 3. Encendido en la transaccion: emitir enruta a su carril
select notificacion.fijar_regla('resumen_diario', true, '2026-11-01T00:00:00Z');
select notificacion.fijar_regla('pendientes_diarios', true, '2026-11-01T00:00:00Z');
select notificacion.fijar_regla('cuenta_vencida', true, '2026-11-01T00:00:00Z');
update seguridad.interruptor set activo = true where clave in ('reglas_automaticas', 'avisos_inventario');
update agente.aviso_regla set activo = true where codigo = 'inv_agotado';
select is(notificacion.emitir_estado('resumen_diario', 'ig:r1', '{"texto":"resumen"}', null, '2026-11-17T08:00:00Z') ->> 'estado', 'emitido', 'reloj: emite por la puerta unica');
select is(notificacion.emitir_estado('resumen_diario', 'ig:r1', '{"texto":"resumen"}', null, '2026-11-17T08:00:00Z') ->> 'estado', 'duplicado', 'misma clave no se repite');
select is(notificacion.emitir_estado('inv_agotado', 'ig:i1', '{"modelo":"m"}') ->> 'estado', 'encolado', 'inventario: encola por la misma puerta');
select ok(notificacion.emitir('inv_agotado', 'ig:i2', '{"modelo":"m"}') is not null, 'notificacion.emitir devuelve el id');

-- 4. Cesion: con cobranza encendida, las reglas de cobranza del reloj ceden
select is(notificacion.emitir_estado('cuenta_vencida', 'ig:c1', '{"texto":"vencida"}', null, '2026-11-17T09:00:00Z') ->> 'estado', 'emitido', 'sin cobranza_activa la regla del reloj emite');
update seguridad.interruptor set activo = true where clave = 'cobranza_activa';
select is(notificacion.emitir_estado('cuenta_vencida', 'ig:c2', '{"texto":"vencida"}', null, '2026-11-18T09:00:00Z') ->> 'estado', 'cedida_a_cobranza', 'con cobranza_activa la regla del reloj cede (un solo mensaje por hecho)');
update seguridad.interruptor set activo = false where clave = 'cobranza_activa';

-- 5. Techo unico: los digest de inventario y de cobranza cuentan en el mismo libro
select is(notificacion.mensajes_dia('2026-12-01'), 0, 'dia limpio: 0 mensajes');
select ok(notificacion.contar_envio('ig:z1', 'cobranza_digest', 'cobranza_digest_am', 'I', '2026-12-01'), 'cobranza anota su digest');
select ok(notificacion.contar_envio('ig:z2', 'inventario_digest', 'digest_inventario_M', 'I', '2026-12-01'), 'inventario anota su digest');
select is(notificacion.contar_envio('ig:z2', 'inventario_digest', 'digest_inventario_M', 'I', '2026-12-01'), false, 'anotar dos veces la misma clave no cuenta doble');
select notificacion.contar_envio('ig:z' || g, 'x', 'x', 'I', '2026-12-01') from generate_series(3, 5) g;
select is(notificacion.mensajes_dia('2026-12-01'), 5, '5 mensajes de fuentes distintas en el libro unico');
select notificacion.fijar_regla('margen_bajo', true, '2026-11-01T00:00:00Z');
select is(notificacion.emitir_estado('margen_bajo', 'ig:m1', '{"texto":"margen","severidad":"I"}', null, '2026-12-01T16:00:00Z') ->> 'estado', 'emitido', 'el sexto mensaje del dia sale (alerta del reloj)');
select is(notificacion.emitir_estado('resumen_diario', 'ig:t2', '{"texto":"otro"}', null, '2026-12-01T17:00:00Z') ->> 'estado', 'techo', 'el septimo ya no sale: techo compartido');
select is((agente.avisos_digest_armar('S', '2026-12-01T17:00:00Z') -> 'items'), '[]'::jsonb, 'el digest de inventario respeta el mismo techo');
select is(notificacion.emitir_estado('libro_no_cuadra', 'ig:crit', '{"texto":"rojo","severidad":"C"}', null, '2026-12-01T18:00:00Z') ->> 'estado', 'apagada', 'critico con su regla apagada tampoco sale');

-- 6. Fusion: M y R viajan dentro del reporte del reloj cuando este esta encendido
select is(agente.avisos_digest_armar('M', '2026-12-02T15:00:00Z') ->> 'estado', 'fusionado', 'ventana M sin mensaje propio con pendientes_diarios encendido');
select is(agente.avisos_digest_armar('M', '2026-12-02T15:00:00Z', true) ->> 'estado', 'ok', 'el reporte del reloj pide las lineas con p_fusion');
select is(agente.avisos_digest_armar('S', '2026-12-02T15:00:00Z', true) ->> 'estado', 'sin_fusion', 'S nunca se fusiona');
select notificacion.fijar_regla('pendientes_diarios', false);
select is(agente.avisos_digest_armar('M', '2026-12-02T15:00:00Z') ->> 'estado', 'ok', 'con el reporte apagado la ventana M manda su propio mensaje');

select * from finish();
rollback;
