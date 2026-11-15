-- pgTAP carril RELOJ del bot de Telegram: reloj en la base (apagado de origen), cola y vaciado, reglas con interruptor propio, nada hacia atras, techo/silencio/enfriamiento/dedup,
-- cifras agente.rep_* contra el libro y evaluadores de alertas con reloj simulado (se avanza la fecha pasando p_hoy/p_ahora). Datos sinteticos "RL"; no se envia nada.
begin;
select no_plan();
select set_config('rtm.canal', 'importacion', true);
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('rl.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('72222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rl.socio@example.test');
select set_config('request.jwt.claim.sub', '72222222-2222-2222-2222-222222222222', true);
select agente.registrar_miembro(5160001, 'angelo');
select agente.registrar_miembro(5160002, 'javier');

-- ================================================================= 1. el reloj: nace apagado, cuenta, no envia, vigia
select is((select count(*)::int from seguridad.interruptor where clave in ('reloj_activo', 'reloj_http', 'reglas_automaticas') and activo), 0, 'reloj_activo, reloj_http y reglas_automaticas nacen APAGADOS');
select is((select count(*)::int from reloj.job where activo), 0, 'los jobs nacen DESACTIVADOS');
select is((select count(*)::int from reloj.job), 2, 'dos jobs sembrados: latido y vigia');
select is((select count(*)::int from seguridad.interruptor i join notificacion.regla r on r.interruptor = i.clave where i.activo), 0, 'todas las reglas nacen apagadas');
select ok((select count(*)::int from notificacion.regla) >= 12, 'hay reglas sembradas (resumen, pendientes y las de evaluador)');
select is(has_function_privilege('anon', 'reloj.tick(text,timestamptz)', 'execute'), false, 'anon no corre el reloj');
select is(has_function_privilege('authenticated', 'reloj.tick(text,timestamptz)', 'execute'), false, 'authenticated no corre el reloj');
select is(has_function_privilege('servidor', 'reloj.tick(text,timestamptz)', 'execute'), true, 'servidor si');
select is(has_function_privilege('authenticated', 'agente.rep_telegram(date)', 'execute'), false, 'las cifras rep_* no son de authenticated');
select is(has_function_privilege('servidor', 'agente.rep_telegram(date)', 'execute'), true, 'las cifras rep_* son del servidor');
select is(has_function_privilege('authenticated', 'notificacion.vaciar_pendientes(boolean,timestamptz)', 'execute'), false, 'vaciar_pendientes no es de authenticated');
select is(has_function_privilege('servidor', 'reloj._pedir_latido()', 'execute'), false, 'el ayudante _pedir_latido no se concede');

create temp table _t0 as select reloj.tick('manual', '2026-11-20 12:00+00'::timestamptz) as j;
select is((select j ->> 'modo' from _t0), 'sin_enviar', 'con reloj_http apagado el tick es latido SIN ENVIAR');
select is((select count(*)::int from reloj.solicitud), 0, 'sin enviar: ninguna peticion HTTP');
select is((select ejecuciones from reloj.contador), 1::bigint, 'el contador de ejecuciones cuenta');
select is((reloj.verificar('2026-11-20 12:05+00') ->> 'esperado')::boolean, false, 'reloj_activo apagado: la vigia no espera latido');
-- reloj caido: se espera latido, ya pasaron 40 minutos y la regla esta encendida
select reloj.encender();
select is((select count(*)::int from reloj.job where activo), 2, 'encender activa los jobs (no enciende http ni reglas)');
select is(reloj._interruptor('reloj_http'), false, 'encender NO enciende reloj_http');
select is(reloj._interruptor('reglas_automaticas'), false, 'encender NO enciende las reglas');
select is((reloj.verificar('2026-11-20 12:40+00') ->> 'caido')::boolean, true, 'sin latido en 40 min (tolerancia 15): reloj caido');
select is((select count(*)::int from operacion.aviso where codigo = 'tarea_sin_latido' and clave_dedupe like 'reloj_caido:%'), 0, 'con la regla reloj_caido apagada no se emite el aviso');
update seguridad.interruptor set activo = true where clave in ('reglas_automaticas', 'regla_reloj_caido');
select is((reloj.verificar('2026-11-20 12:41+00') ->> 'aviso') is not null, true, 'regla encendida: se emite el aviso de reloj caido');
select is((select count(*)::int from operacion.aviso where codigo = 'tarea_sin_latido' and clave_dedupe like 'reloj_caido:%'), 1, 'un aviso de caida');
select reloj.verificar('2026-11-20 12:42+00');
select is((select count(*)::int from operacion.aviso where codigo = 'tarea_sin_latido' and clave_dedupe like 'reloj_caido:%'), 1, 'la misma caida no duplica el aviso');
select reloj.tick('manual', '2026-11-20 12:43+00');
select is((reloj.verificar('2026-11-20 12:44+00') ->> 'caido')::boolean, false, 'vuelve el latido: ya no esta caido');
select is((select estado from operacion.aviso where clave_dedupe like 'reloj_caido:%'), 'resuelta', 'el asunto se resuelve solo');
select is((select ejecuciones from reloj.contador), 2::bigint, 'dos ejecuciones contadas');
-- reintento SOLO con respuesta registrada no 2xx
update seguridad.interruptor set activo = true where clave in ('reloj_http', 'reloj_transporte_simulado');
select reloj.tick('simulado', '2026-11-21 10:00+00');
create temp table _s as select id, net_request_id from reloj.solicitud order by id limit 1;
select is((select count(*)::int from reloj.solicitud), 1, 'con reloj_http se registra una peticion');
select is((reloj.reintentar('2026-11-21 10:01+00') ->> 'reintentos')::int, 0, 'antes de la espera no se revisa nada');
select is((reloj.reintentar('2026-11-21 10:05+00') ->> 'sin_respuesta')::int, 1, 'sin respuesta registrada: NO se reenvia, se marca sin_respuesta');
select is((select count(*)::int from reloj.solicitud), 1, 'sin respuesta: no hay segunda peticion');
select is((select count(*)::int from operacion.aviso where clave_dedupe like 'reloj_sin_respuesta:%'), 1, 'sin respuesta: aviso unico');
insert into reloj.respuesta_simulada (net_request_id, status_code) select net_request_id, 503 from _s;
select is((reloj.reintentar('2026-11-21 10:06+00') ->> 'reintentos')::int, 1, 'respuesta 503 registrada: se reintenta una vez');
select is((select count(*)::int from reloj.solicitud), 2, 'segunda peticion creada');
select is((select estado from reloj.solicitud where id = (select id from _s)), 'fallida', 'la primera queda fallida');
insert into reloj.respuesta_simulada (net_request_id, status_code) select net_request_id, 200 from reloj.solicitud where reintento_de is not null;
select is((reloj.reintentar('2026-11-21 10:12+00') ->> 'ok')::int, 1, 'respuesta 200: queda ok');
select is((reloj.reintentar('2026-11-21 10:20+00') ->> 'reintentos')::int, 0, 'una solicitud ok no se repite');
select reloj.apagar();
select is((select count(*)::int from reloj.job where activo), 0, 'apagar desactiva los jobs');
select is(reloj._interruptor('reloj_http') or reloj._interruptor('reloj_activo'), false, 'apagar deja reloj_activo y reloj_http apagados');
update seguridad.interruptor set activo = false where clave in ('reglas_automaticas', 'regla_reloj_caido', 'reloj_transporte_simulado');

-- ================================================================= 2. cola: vaciado seguro y nada hacia atras
update seguridad.interruptor set activo = true where clave = 'telegram_envio';
select operacion.avisar('resumen_diario', null, 'rl:hist:1', 'F', 'Historico 1', null, null, '{"texto":"x"}'::jsonb);
select operacion.avisar('resumen_diario', null, 'rl:hist:2', 'F', 'Historico 2', null, null, '{"texto":"y"}'::jsonb);
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe like 'rl:hist:%' and e.estado = 'pendiente'), 2, 'con telegram_envio encendido las entregas nacen pendientes');
create temp table _v as select notificacion.vaciar_pendientes(false) as j;
select ok((select (j ->> 'por_vaciar')::int from _v) >= 2, 'verificar: reporta lo que hay por vaciar');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe like 'rl:hist:%' and e.estado = 'pendiente'), 2, 'verificar no cambia nada');
create temp table _v2 as select notificacion.vaciar_pendientes(true) as j;
select is((select (j ->> 'pendientes_despues')::int from _v2), 0, 'aplicar: ninguna pendiente');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe like 'rl:hist:%' and e.estado = 'omitida' and e.codigo_error = 'vaciado_historico'), 2, 'las historicas quedan omitidas con su motivo');
select is((notificacion.vaciar_pendientes(true) ->> 'vaciadas')::int, 0, 'idempotente: la segunda corrida no cambia nada');
select is(jsonb_array_length(notificacion.reclamar_entregas(10)), 0, 'despues del vaciado el despacho no encuentra nada que enviar');
update seguridad.interruptor set activo = false where clave = 'telegram_envio';

-- ================================================================= 3. emision programada: apagada no sale; dedup; enfriamiento; techo; silencio; critico
select is((notificacion.emitir_programado('resumen_diario', 'rl:k1', 'F', 'R', 'texto')) ->> 'estado', 'apagada', 'regla apagada: no sale nada (ni aviso)');
select is((select count(*)::int from operacion.aviso where clave_dedupe = 'rl:k1'), 0, 'regla apagada: no queda aviso');
select notificacion.fijar_regla('resumen_diario', true, '2026-11-20 14:00+00');
select is((notificacion.emitir_programado('resumen_diario', 'rl:k1', 'F', 'R', 'texto')) ->> 'estado', 'apagada', 'regla encendida pero el maestro apagado: no sale');
update seguridad.interruptor set activo = true where clave = 'reglas_automaticas';
select is((notificacion.emitir_programado('resumen_diario', 'rl:k1', 'F', 'R', 'texto', null, null, '{}', '2026-11-20 14:00+00')) ->> 'estado', 'emitido', 'con maestro y regla encendidos: sale');
select is((notificacion.emitir_programado('resumen_diario', 'rl:k1', 'F', 'R', 'texto', null, null, '{}', '2026-11-20 14:01+00')) ->> 'estado', 'duplicado', 'misma clave estable: duplicado');
select is((notificacion.emitir_programado('resumen_diario', 'rl:k2', 'F', 'R', 'texto', null, null, '{}', '2026-11-20 15:00+00')) ->> 'estado', 'enfriamiento', 'misma clase dentro del enfriamiento: no sale');
select is((select codigo_error from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'rl:k1'), 'interruptor_apagado', 'telegram_envio apagado: la entrega queda omitida (nada sale)');
select is((notificacion.emitir_programado('resumen_diario', 'rl:k3', 'F', 'R', 'texto', null, null, '{}', '2026-11-22 15:00+00')) ->> 'estado', 'emitido', 'pasado el enfriamiento (dos dias despues) vuelve a salir');
-- techo diario de 6: seis clases distintas el mismo dia, la septima no sale; un critico si
select notificacion.fijar_regla(c, true, '2026-11-20 14:00+00') from unnest(array['pendientes_diarios', 'cobertura_pagos', 'cobranza_vence_manana', 'vencimiento_proveedor', 'fondos_en_poder', 'margen_bajo', 'credito_sin_plazo', 'libro_no_cuadra']) c;
create temp table _techo as select
  notificacion.emitir_programado('pendientes_diarios', 'rl:t1', 'F', 'P', 'p', null, null, '{}', '2026-11-25 15:00+00') ->> 'estado' as a,
  notificacion.emitir_programado('cobertura_pagos', 'rl:t2', 'I', 'P', 'p', null, null, '{}', '2026-11-25 15:01+00') ->> 'estado' as b,
  notificacion.emitir_programado('cobranza_vence_manana', 'rl:t3', 'I', 'P', 'p', null, null, '{}', '2026-11-25 15:02+00') ->> 'estado' as c,
  notificacion.emitir_programado('vencimiento_proveedor', 'rl:t4', 'I', 'P', 'p', null, null, '{}', '2026-11-25 15:03+00') ->> 'estado' as d,
  notificacion.emitir_programado('fondos_en_poder', 'rl:t5', 'I', 'P', 'p', null, null, '{}', '2026-11-25 15:04+00') ->> 'estado' as e,
  notificacion.emitir_programado('margen_bajo', 'rl:t6', 'I', 'P', 'p', null, null, '{}', '2026-11-25 15:05+00') ->> 'estado' as f,
  notificacion.emitir_programado('resumen_diario', 'rl:t7', 'F', 'P', 'p', null, null, '{}', '2026-11-25 15:06+00') ->> 'estado' as g,
  notificacion.emitir_programado('libro_no_cuadra', 'rl:t8', 'C', 'P', 'p', null, null, '{}', '2026-11-25 15:07+00') ->> 'estado' as h;
select is((select a || b || c || d || e || f from _techo), 'emitidoemitidoemitidoemitidoemitidoemitido', 'seis mensajes del dia salen');
select is((select g from _techo), 'techo', 'el septimo del dia no sale (techo de 6)');
select is((select h from _techo), 'emitido', 'un critico sale aunque se llegue al techo');
select is((notificacion.emitir_programado('resumen_diario', 'rl:t9', 'F', 'P', 'p', null, null, '{}', '2026-11-27 15:00+00')) ->> 'estado', 'emitido', 'al dia siguiente el techo se reinicia');
-- silencio 21:00 a 07:00 (Merida = UTC-6): 22:00 Merida = 04:00 UTC del dia siguiente
select notificacion.emitir_programado('cobranza_vence_manana', 'rl:s1', 'I', 'S', 's', null, null, '{}', '2026-12-02 04:00+00');
select is((select (e.siguiente_intento_at at time zone 'America/Merida')::text from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'rl:s1' and e.canal = 'telegram'), '2026-12-02 07:00:00', 'a las 22:00 un informativo espera a las 07:00 del dia siguiente');
select notificacion.emitir_programado('libro_no_cuadra', 'rl:s2', 'C', 'S', 's', null, null, '{}', '2026-12-02 04:00+00');
select ok((select e.siguiente_intento_at from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'rl:s2' and e.canal = 'telegram') <= now(), 'un critico a la misma hora no espera');
select notificacion.emitir_programado('credito_sin_plazo', 'rl:s3', 'F', 'S', 's', null, null, '{}', '2026-12-03 09:00+00');
select ok((select e.siguiente_intento_at from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'rl:s3' and e.canal = 'telegram') is null, 'credito_sin_plazo es solo software: no genera entrega de Telegram');
-- nada hacia atras: una regla que se apaga y se vuelve a encender reinicia su ventana
select notificacion.fijar_regla('margen_bajo', false);
select is(notificacion.regla_ventana('margen_bajo', '2026-12-05 10:00+00'), null, 'apagada: sin ventana');
select notificacion.fijar_regla('margen_bajo', true, '2026-12-06 10:00+00');
select is((select activa_desde from notificacion.regla where codigo = 'margen_bajo'), '2026-12-06 10:00+00'::timestamptz, 'al encender se fija el instante desde el que cuentan los hechos');

-- ================================================================= 4. cifras agente.rep_* contra el libro (y evaluadores con reloj simulado)
-- Punto de partida limpio dentro de la transaccion: neutraliza saldos de proveedores y socios (como 007).
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-rl', '{}'::jsonb);
insert into operacion.cuenta_proveedor_mov (proveedor_id, fecha_neg, concepto, monto_cent, nota, evento_id)
  select p.id, negocio.hoy(), 'ajuste', -operacion.saldo_proveedor(p.id), 'neutraliza para la prueba', (select max(id) from operacion.evento) from catalogo.proveedor p where operacion.saldo_proveedor(p.id) <> 0;
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;
do $$ begin
  if not exists (select 1 from catalogo.persona_bodega) then
    perform catalogo.asegurar_cliente('RL Omar Cliente', 'Javier');
    perform catalogo.asegurar_persona_bodega('RL Omar Cliente', 'RL Omar');
  end if;
end $$;
select catalogo.asegurar_cliente('RL Cliente Uno', 'Javier');
select catalogo.asegurar_cliente('RL Cliente Dos', 'Javier');
select catalogo.asegurar_cliente('RL Cliente Tres', 'Angelo');
select catalogo.asegurar_modelo('RL Marca', 'RL Modelo', 10000, 'ambas');
select catalogo.asegurar_sku('RL Modelo', 'Uva');
select catalogo.fijar_costo('rl:k', 'Karen', 'RL Modelo', 10000, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_costo('rl:k2', 'Isaac', 'RL Modelo', 11000, negocio.hoy() - 60, 'prueba');
select catalogo.fijar_precio('rl:p1', 'RL Cliente Uno', 'RL Modelo', 25000, negocio.hoy() - 60, 'chat');
select catalogo.fijar_precio('rl:p2', 'RL Cliente Dos', 'RL Modelo', 25000, negocio.hoy() - 60, 'chat');
select catalogo.fijar_precio('rl:p3', 'RL Cliente Tres', 'RL Modelo', 11000, negocio.hoy() - 60, 'chat');
select operacion.registrar_movimiento('rl:m1', 'RL Modelo', 'Uva', 'bodega_omar', 'entrada_compra', 200, 2200000, negocio.hoy() - 40);
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.args(p jsonb) returns jsonb language sql as $$ select jsonb_build_object('autor', 'angelo', 'telegram_user_id', 5160001, 'origen', 'x') || p $$;
create function pg_temp.pedido(p_clave text, p_cliente text, p_pz int, p_plazo int, p_dia date) returns text language plpgsql as $$
declare v_folio text;
begin
  perform set_config('rtm.fecha_negocio', p_dia::text, true);
  v_folio := agente.ejecutar_ext(p_clave, 'pedido_crear', pg_temp.args(jsonb_build_object('plazo_dias', p_plazo, 'cliente_id', pg_temp.cid(p_cliente), 'lineas', jsonb_build_array(jsonb_build_object(
    'modelo_id', (select id from catalogo.modelo where nombre_canonico = 'RL Modelo'), 'sabor_id', (select id from catalogo.sabor where nombre_canonico = 'Uva'), 'piezas', p_pz))))) ->> 'folio';
  perform agente.ejecutar_ext(p_clave || 'e', 'pedido_enviar', pg_temp.args(jsonb_build_object('pedido_folio', v_folio, 'aceptar_avisos', true)));
  perform set_config('rtm.fecha_negocio', '', true);
  return v_folio;
end $$;
-- Dia base D = hoy de negocio. Cliente Uno: 10 pz enviadas hace 10 dias a plazo 7 (vencido hace 3 dias). Cliente Dos: 6 pz hace 6 dias a plazo 7 (vence manana).
-- Cliente Tres: 4 pz hoy a plazo 15 (margen cero: precio = costo de Isaac, 11000 por pieza vs costo de bodega).
create temp table _d as select negocio.hoy() as d;
select ok(pg_temp.pedido('rl:ped1', 'RL Cliente Uno', 10, 7, (select d - 10 from _d)) ~ '^[A-Z]+-[0-9]{3}$', 'pedido 1 enviado hace 10 dias');
select ok(pg_temp.pedido('rl:ped2', 'RL Cliente Dos', 6, 7, (select d - 6 from _d)) ~ '^[A-Z]+-[0-9]{3}$', 'pedido 2 enviado hace 6 dias');
select ok(pg_temp.pedido('rl:ped3', 'RL Cliente Tres', 4, 15, (select d from _d)) ~ '^[A-Z]+-[0-9]{3}$', 'pedido 3 enviado hoy');
select contabilidad.asentar_pendientes();
create temp table _cx as select agente.rep_telegram((select d from _d)) as r, agente.rep_cartera_vencimientos((select d from _d)) as c, agente.rep_concentracion((select d from _d)) as k;
-- Las cifras de rep_* son las del libro, al centavo.
select is((select (r ->> 'por_cobrar_cent')::bigint from _cx),
  (select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0)::bigint from operacion.pedido pe where pe.estado = 'enviado') + (select coalesce(sum(greatest(a.saldo_cent, 0)), 0)::bigint from operacion.cxc_apertura() a),
  'por cobrar del resumen = suma de saldos de pedidos enviados (libro) al centavo');
select is((select (r -> 'ventas' ->> 'pedidos')::int from _cx), 1, 'ventas del dia: un pedido enviado hoy');
select is((select (r -> 'ventas' ->> 'piezas')::int from _cx), 4, 'ventas del dia: 4 piezas');
select is((select (r -> 'ventas' ->> 'facturado_cent')::bigint from _cx), (select operacion.pedido_cobrado(pe.id) from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where c.nombre_canonico = 'RL Cliente Tres'), 'facturado del dia = pedido_cobrado del libro');
select is((select (r ->> 'vencidos_cent')::bigint from _cx), (select operacion.pedido_saldo(pe.id) from operacion.pedido pe join catalogo.cliente c on c.id = pe.cliente_id where c.nombre_canonico = 'RL Cliente Uno'), 'vencidos = saldo del cliente uno (vencio hace 3 dias)');
select is((select (r -> 'por_pagar' ->> 'total_cent')::bigint from _cx), (operacion.por_pagar_renglones() ->> 'total_cent')::bigint, 'por pagar = por_pagar_renglones del libro');
select is((select jsonb_array_length(c -> 'vencen_manana') from _cx), 1, 'vencen manana: un cliente');
select is((select c -> 'vencen_manana' -> 0 ->> 'cliente' from _cx), 'RL Cliente Dos', 'vence manana el cliente dos');
select is((select jsonb_array_length(c -> 'vencidos') from _cx), 1, 'vencidos: un cliente');
select is((select (c -> 'vencidos' -> 0 ->> 'dias_atraso_max')::int from _cx), 3, 'atraso de 3 dias');
select is((select (k ->> 'total_cent')::bigint from _cx), (select (r ->> 'cartera_pedidos_cent')::bigint from _cx), 'concentracion: el total es la cartera');
select is((select (k ->> 'mayor_bp')::int from _cx), negocio.redondear_medio_arriba((select (c -> 'vencidos' -> 0 ->> 'saldo_cent')::bigint from _cx) * 10000, (select (k ->> 'total_cent')::bigint from _cx))::int, 'concentracion: el mayor en puntos base, calculado por SQL');
-- Margen: el pedido 3 (precio 110.00 contra costo) queda bajo el minimo; los otros no.
select is((select jsonb_array_length(agente.rep_margen((select d from _d), (select d - 20 from _d)) -> 'pedidos')), (select count(*)::int from jsonb_array_elements(agente.rep_margen((select d from _d), (select d - 20 from _d)) -> 'pedidos') x where (x ->> 'margen_bp')::int < 500), 'rep_margen solo lista los menores al minimo');
-- Proveedores: dos compras con Isaac (plazo 7); FIFO con un pago
create temp table _c1 as select operacion.crear_compra('rl:c1', 'Isaac', '[{"modelo":"RL Modelo","sabor":"Uva","pagadas":10}]'::jsonb, 0, 0, (select d - 9 from _d)) as j;
select lives_ok($$select operacion.confirmar_compra('rl:c1c', (select id from operacion.compra where folio = (select j ->> 'folio' from _c1)))$$, 'compra 1 con Isaac confirmada (hace 9 dias)');
create temp table _c2 as select operacion.crear_compra('rl:c2', 'Isaac', '[{"modelo":"RL Modelo","sabor":"Uva","pagadas":5}]'::jsonb, 0, 0, (select d - 5 from _d)) as j;
select lives_ok($$select operacion.confirmar_compra('rl:c2c', (select id from operacion.compra where folio = (select j ->> 'folio' from _c2)))$$, 'compra 2 con Isaac confirmada (hace 5 dias)');
select contabilidad.asentar_pendientes();
create temp table _vp as select agente.rep_vencimientos_proveedor((select d from _d)) as r;
select is((select p ->> 'plazo_dias' from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), '7', 'plazo de Isaac: 7 dias');
select is((select p ->> 'plazo_dias' from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Karen'), '10', 'plazo de Karen: 10 dias');
select is((select (p ->> 'deuda_cent')::bigint from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), (operacion.posicion_proveedor(catalogo.proveedor_id('Isaac')) ->> 'deuda_empresa_cent')::bigint, 'deuda con Isaac = la del libro');
select is((select jsonb_array_length(p -> 'filas') from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 2, 'sin pagos: las dos compras estan pendientes');
select is((select (p ->> 'vencido_cent')::bigint from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), (select (p -> 'filas' -> 0 ->> 'pendiente_cent')::bigint from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 'la compra de hace 9 dias ya vencio (plazo 7)');
-- Pago FIFO: se paga lo equivalente a la primera compra; queda pendiente solo la segunda
select operacion.pago_proveedor_de_socio('rl:pp1', 'Isaac', (select (p -> 'filas' -> 0 ->> 'pendiente_cent')::bigint from _vp, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 'Angelo', 'auto', (select d from _d));
select contabilidad.asentar_pendientes();
create temp table _vp2 as select agente.rep_vencimientos_proveedor((select d from _d)) as r;
select is((select jsonb_array_length(p -> 'filas') from _vp2, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 1, 'FIFO: pagada la primera, queda solo la segunda pendiente');
select is((select p -> 'filas' -> 0 ->> 'vence' from _vp2, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), (select (d - 5 + 7)::text from _d), 'la pendiente vence a los 7 dias de su compra');
select is((select (p ->> 'sin_fecha_cent')::bigint from _vp2, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 0::bigint, 'toda la deuda tiene fecha');
-- Liquidez
create temp table _lq as select agente.rep_liquidez((select d from _d)) as r;
select is((select (r ->> 'pagable_cent')::bigint from _lq), (select (p ->> 'deuda_cent')::bigint from _vp2, jsonb_array_elements(r -> 'proveedores') p where p ->> 'proveedor' = 'Isaac'), 'liquidez: lo pagable es la deuda con proveedores');
select is((select (r ->> 'cobertura_centesimas')::int from _lq), negocio.redondear_medio_arriba((select (r ->> 'cobrable_cent')::bigint * 100 from _lq), (select (r ->> 'pagable_cent')::bigint from _lq))::int, 'cobertura en centesimas calculada por SQL');
select is((select (r ->> 'fecha_pago')::date from _lq), (select d + 2 from _d), 'la fecha de pago es el proximo vencimiento de proveedor');

-- ---------------------------------------------------------------- evaluadores con reloj simulado (todas las reglas ya estan encendidas en esta transaccion: maestro + las que se encendieron arriba)
select notificacion.fijar_regla(c, false) from unnest(array['resumen_diario', 'pendientes_diarios', 'cobertura_pagos', 'cobranza_vence_manana', 'vencimiento_proveedor', 'fondos_en_poder', 'margen_bajo', 'credito_sin_plazo', 'libro_no_cuadra']) c;
select is((notificacion.evaluar_reglas((select d from _d), now()) -> 'reglas'), '{}'::jsonb, 'todas apagadas: el motor no evalua ni emite nada');
delete from notificacion.programado; delete from notificacion.estado_evaluador where clave like 'cruce:%' or clave like 'cobertura_bajo' or clave like 'margen_avisados';
-- Reloj simulado: la regla se enciende el dia D (con el pedido 1 YA vencido hace 3 dias): no se emite hacia atras
select notificacion.fijar_regla('cuenta_vencida', true, (select (d::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
select notificacion.fijar_regla('cobranza_vence_manana', true, (select (d::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
create temp table _e0 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '13 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'cuenta_vencida' ->> 'emitidas' from _e0), '0', 'nada hacia atras: lo que ya estaba vencido al encender la regla no se avisa');
select is((select j -> 'reglas' -> 'cobranza_vence_manana' ->> 'emitidas' from _e0), '1', 'lo que vence manana si es un hecho nuevo: se avisa');
select is((select count(*)::int from operacion.aviso where clave_dedupe like 'cobro_manana:%'), 1, 'un solo aviso agrupado');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'cobro_manana:%') like '%RL CLIENTE DOS%', 'el texto agrupa por cliente y va en mayusculas');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'cobro_manana:%') like '%$%', 'el texto trae el monto en pesos formateado por SQL');
-- Segunda pasada del mismo dia: sin duplicados
create temp table _e1 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '14 hours') at time zone 'America/Merida' from _d)) as j;
select is((select count(*)::int from operacion.aviso where clave_dedupe like 'cobro_manana:%'), 1, 'repetir el latido el mismo dia no duplica');
-- Avanza el reloj: dentro de 8 dias de la fecha del pedido uno ya cruzo el dia 8 de atraso? (vence D-3, +8 = D+5)
create temp table _e2 as select notificacion.evaluar_reglas((select d + 4 from _d), (select ((d + 4)::timestamp + interval '13 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'cuenta_vencida' ->> 'emitidas' from _e2), '1', 'dia D+4: el cliente dos cruzo su dia 1 de atraso despues de activar (el uno aun no cruza los 8 dias)');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'vencidas:%' order by id limit 1) like '%RL CLIENTE DOS%' and (select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'vencidas:%' order by id limit 1) not like '%RL CLIENTE UNO%', 'el aviso del dia 1 es solo del cliente dos');
create temp table _e3 as select notificacion.evaluar_reglas((select d + 5 from _d), (select ((d + 5)::timestamp + interval '13 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'cuenta_vencida' ->> 'emitidas' from _e3), '1', 'dia D+5: cruza los 8 dias de atraso despues de activar la regla: se avisa');
create temp table _e4 as select notificacion.evaluar_reglas((select d + 5 from _d), (select ((d + 5)::timestamp + interval '16 hours') at time zone 'America/Merida' from _d)) as j;
select is((select count(*)::int from operacion.aviso where codigo = 'cuenta_vencida' and clave_dedupe like 'vencidas:%'), 2, 'dos avisos en total (dia 1 del cliente dos; dia 8 del cliente uno): el mismo cruce no se repite');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'vencidas:%' order by id desc limit 1) like '%RL CLIENTE UNO%', 'el aviso del dia 8 es del cliente uno');
-- Vencimiento de proveedor (regla propia): se enciende y la segunda compra (vence D+2) avisa a 3, 1 y 0 dias; la ya vencida no hacia atras
select notificacion.fijar_regla('vencimiento_proveedor', true, (select ((d - 1)::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
create temp table _e5 as select notificacion.evaluar_reglas((select d - 1 from _d), (select ((d - 1)::timestamp + interval '13 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'vencimiento_proveedor' ->> 'emitidas' from _e5), '1', 'a 3 dias del vencimiento de Isaac se avisa (FIFO: solo lo pendiente)');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'vprov:isaac:%' order by id limit 1) like '%plazo 7%', 'el aviso menciona el plazo de Isaac');
create temp table _e6 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '13 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'vencimiento_proveedor' ->> 'emitidas' from _e6), '0', 'a 2 dias no hay aviso (solo a 3, 1 y 0)') ;
-- Cobertura: cruce de >= 1.0 a < 1.0 solo una vez
select notificacion.fijar_regla('cobertura_pagos', true, (select ((d - 1)::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
create temp table _e7 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '15 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'cobertura_pagos' ->> 'emitidas' from _e7), '0', 'la primera lectura solo anota el estado (no es un cruce)');
select is((select count(*)::int from operacion.aviso where clave_dedupe like 'cobertura:%'), 0, 'cobertura: nada emitido sin cruce');
-- Cobertura: forzando el estado previo a >= 1.0, un cruce real a < 1.0 se emite una sola vez
select notificacion._estado_set('cobertura_bajo', 'false'::jsonb);
create temp table _e7b as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '15 hours 30 minutes') at time zone 'America/Merida' from _d)) as j, (agente.rep_liquidez((select d from _d)) ->> 'bajo_uno')::boolean as bajo;
select is((select (j -> 'reglas' -> 'cobertura_pagos' ->> 'emitidas')::int from _e7b), (select bajo::int from _e7b), 'cobertura: se emite exactamente cuando cruza a menos de 1.0');
-- Margen bajo: el pedido 3 se envio hoy (despues de activar)
select notificacion.fijar_regla('margen_bajo', true, (select ((d - 1)::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
create temp table _e8 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '16 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'margen_bajo' ->> 'emitidas' from _e8), '1', 'margen: el pedido enviado hoy con margen cero se avisa');
select ok((select payload ->> 'texto' from operacion.aviso where clave_dedupe like 'margen:%' limit 1) like '%RL CLIENTE TRES%', 'el aviso de margen nombra al cliente en mayusculas');
select is((select count(*)::int from operacion.aviso where clave_dedupe like 'margen:%'), 1, 'margen: los pedidos de los otros clientes (margen normal) no se avisan');
create temp table _e8b as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '22 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'margen_bajo' ->> 'emitidas' from _e8b), '0', 'margen: el mismo pedido no se avisa dos veces');
-- Libro que no cuadra: solo un cambio verde -> rojo emite (la primera lectura solo anota)
select notificacion.fijar_regla('libro_no_cuadra', true, (select ((d - 1)::timestamp + interval '12 hours') at time zone 'America/Merida' from _d));
create temp table _e9 as select notificacion.evaluar_reglas((select d from _d), (select (d::timestamp + interval '17 hours') at time zone 'America/Merida' from _d)) as j;
select is((select j -> 'reglas' -> 'libro_no_cuadra' ->> 'emitidas' from _e9), '0', 'libro cuadrado: nada que avisar');
select is((select count(*)::int from notificacion.estado_evaluador where clave like 'libro_ok:%'), (select count(*)::int from contabilidad.comprobaciones()), 'cada comprobacion deja su estado anotado');
-- Sin errores de evaluadores
select is((select count(*)::int from notificacion.estado_evaluador where clave like 'error_regla:%'), 0, 'ningun evaluador fallo');
-- El latido envuelto sigue funcionando y devuelve el motor
select ok((notificacion.latido((select d from _d)) ? 'reglas'), 'notificacion.latido() ahora corre tambien el motor de reglas');
select ok((notificacion.latido((select d from _d)) ? 'caducadas'), 'notificacion.latido() conserva el resultado de F3b');
select * from finish();
rollback;
