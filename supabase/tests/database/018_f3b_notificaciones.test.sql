-- pgTAP F3b-2: nucleo de notificaciones (spec 26): emitir idempotente dentro de la transaccion, entrega por canal con estados, agrupacion y limites,
-- tokens de un solo uso, evaluadores, campana (Todas y Sin leer), Tu turno y pulso. Los esperados salen de la especificacion 26 (seccion 13), no del codigo.
-- Dentro de una transaccion `now()` no avanza: las esperas se simulan moviendo `siguiente_intento_at`.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.notif.a@example.test', 'socio', 'Angelo', true), ('f3b.notif.b@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('74444444-4444-4444-4444-444444444441', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.notif.a@example.test'),
  ('74444444-4444-4444-4444-444444444442', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3b.notif.b@example.test');
select set_config('request.jwt.claim.sub', '74444444-4444-4444-4444-444444444441', true);

create function pg_temp.av(p_codigo text, p_clave text, p_entidad bigint default null) returns bigint language sql as
  $$ select operacion.avisar($1, null, $2, null, 'Prueba ' || $1, 'pedido', $3, '{}'::jsonb) $$;
create function pg_temp.entrega(p_clave text, p_canal text default 'telegram') returns bigint language sql as
  $$ select e.id from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = $1 and e.canal = $2 $$;
create function pg_temp.limpiar() returns void language sql as
  $$ update notificacion.entrega e set estado = 'omitida', codigo_error = 'limpieza' from operacion.aviso a where a.id = e.notificacion_id and e.estado = 'pendiente' and a.codigo in ('telegram_entrega_muerta', 'freno_tormenta') $$;
create function pg_temp.listo(p_entrega bigint) returns void language sql as $$ update notificacion.entrega set siguiente_intento_at = now() where id = $1 $$;

-- Catalogo ------------------------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from notificacion.tipo), 127, 'el catalogo trae los 122 tipos de la matriz, el cierre de reparto y los dos avisos de produccion y los dos del paquete perdido (retiro de capital y toma pedida por Omar)');
select is((select count(*)::int from notificacion.tipo where canal = 'OM'), 7, 'siete tipos del chat de Omar (spec 26, seccion 12)');
select is((select activo from notificacion.tipo where codigo = 'omar_sin_existencia'), false, 'omar_sin_existencia nace apagado');
select is((select count(*)::int from notificacion.tipo where codigo like '%despach%'), 0, 'no existe tipo que avise a Omar de despachar (adenda 27, D2)');
select ok(not exists (select 1 from operacion.aviso a where not exists (select 1 from notificacion.tipo t where t.codigo = a.codigo)), 'todo aviso emitido existe en el catalogo');
select throws_ok($$ select operacion.avisar('tipo_que_no_existe', null, 'x:1', 'I', 'x', null, null) $$, '22023', null, 'un tipo fuera del catalogo se rechaza');
select throws_ok($$ select operacion.avisar('conteo_con_diferencia', null, 'x:2', 'I', 'x', null, null, '{"cifra_libre": 5}'::jsonb) $$, '22023', null, 'un payload con claves no permitidas se rechaza');
select is((select requiere_accion from notificacion.tipo where codigo = 'paquete_por_empacar'), true, 'paquete por empacar trae botones (Marcar empacado)');
select is((select requiere_accion from notificacion.tipo where codigo = 'paquete_enviado_con_guia'), false, 'paquete enviado es informativo');

-- Emision idempotente --------------------------------------------------------------------------------------------------------------------------
select pg_temp.av('paquete_por_empacar', 'pe:1', 1);
select pg_temp.av('paquete_por_empacar', 'pe:1', 1);
select is((select count(*)::int from operacion.aviso where clave_dedupe = 'pe:1'), 1, '8 de 26: emitir lo mismo dos veces deja un solo asunto');
select is((select conteo from operacion.aviso where clave_dedupe = 'pe:1'), 2, 'el asunto recurrente solo sube el conteo');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'pe:1'), 1, 'una entrega por canal, no por emision');
select is((select estado from notificacion.entrega where id = pg_temp.entrega('pe:1')), 'omitida', 'con telegram_envio apagado la entrega queda omitida y la campana igual funciona');
select is((select codigo_error from notificacion.entrega where id = pg_temp.entrega('pe:1')), 'interruptor_apagado', 'queda dicho por que');
select is((select count(*)::int from notificacion.destinatario d join operacion.aviso a on a.id = d.aviso_id where a.clave_dedupe = 'pe:1'), 2, 'ambos socios activos son destinatarios');
select is((select canales_previstos from operacion.aviso where clave_dedupe = 'pe:1'), array['software', 'telegram'], 'canales previstos segun el catalogo');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'aviso_precio_tabulador'), 0, 'un tipo solo de software no crea entregas');

-- Interruptores encendidos: entregas reales ---------------------------------------------------------------------------------------------------
update seguridad.interruptor set activo = true where clave in ('telegram_envio', 'correo_envio');
select pg_temp.av('paquete_enviado_con_guia', 'env:1', 1);
select is((select estado from notificacion.entrega where id = pg_temp.entrega('env:1')), 'pendiente', 'con el interruptor encendido la entrega queda pendiente');
select is((select destino_clave from notificacion.entrega where id = pg_temp.entrega('env:1')), 'grupo_socios', 'el bot manda todo al grupo de los dos socios');
-- Agrupacion: el primero sale, los siguientes salen juntos al cierre de la ventana de 15 min
select pg_temp.av('paquete_enviado_con_guia', 'env:2', 2);
select pg_temp.av('paquete_enviado_con_guia', 'env:3', 3);
select is((select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('env:2')), (select creada_at + interval '15 minutes' from notificacion.entrega where id = pg_temp.entrega('env:1')), '14: el segundo informativo espera al cierre de la ventana de agrupacion');
select is((select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('env:3')), (select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('env:2')), 'y el tercero sale junto con el segundo');
-- Correo corto diferido 2 h (STC) salvo reportes
select pg_temp.av('integridad_nocturna_falla', 'int:1');
select is((select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('int:1', 'correo')), (select creada_at + interval '2 hours' from notificacion.entrega where id = pg_temp.entrega('int:1', 'correo')), 'el correo de respaldo se difiere 2 h');
select pg_temp.av('reporte_no_salio', 'rep:1');
select is((select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('rep:1', 'correo')), (select creada_at from notificacion.entrega where id = pg_temp.entrega('rep:1', 'correo')), 'los reportes no esperan');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'acceso_dispositivo_nuevo'), 0, 'sin emitir no hay entrega');
select pg_temp.av('acceso_dispositivo_nuevo', 'acc:1');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'acceso_dispositivo_nuevo' and e.canal = 'telegram'), 0, '18: los eventos de acceso nunca generan entrega de Telegram');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'acceso_dispositivo_nuevo' and e.canal = 'correo'), 1, 'solo correo');

-- Despacho: reclamar, una en vuelo por chat, el critico adelanta, el grupo sale junto -------------------------------------------------------
update notificacion.entrega set estado = 'omitida', codigo_error = 'limpieza' where estado = 'pendiente' and (canal = 'correo' or notificacion_id in (select id from operacion.aviso where clave_dedupe in ('int:1', 'rep:1')));
select pg_temp.av('cuenta_proveedor_no_cuadra', 'cr:1');
update notificacion.entrega set creada_at = creada_at + interval '1 minute' where id = pg_temp.entrega('cr:1');
select pg_temp.listo(pg_temp.entrega('env:2'));
select pg_temp.listo(pg_temp.entrega('env:3'));
create temp table _lote on commit drop as select notificacion.reclamar_entregas(10, 120) as j;
select is(jsonb_array_length((select j from _lote)), 1, 'una sola entrega en vuelo por chat');
select is((select (j -> 0 -> 'miembros' -> 0 ->> 'tipo') from _lote), 'cuenta_proveedor_no_cuadra', '13: un critico adelanta a un informativo');
select is((select estado from notificacion.entrega where id = pg_temp.entrega('cr:1')), 'enviando', 'queda en envio con su lease');
select ok((select lease_hasta > now() from notificacion.entrega where id = pg_temp.entrega('cr:1')), 'con lease de 120 s');
select is((select notificacion.registrar_resultado(pg_temp.entrega('cr:1'), 'ok', 200, null, null, '4401')), 'enviada', 'ok => enviada (solo el correo llega a entregada)');
select is((select mensaje_externo_id from notificacion.entrega where id = pg_temp.entrega('cr:1')), '4401', 'guarda el id del mensaje');
create temp table _lote2 on commit drop as select notificacion.reclamar_entregas(10, 120) as j;
select is((select jsonb_array_length(j -> 0 -> 'miembros') from _lote2), 3, 'los informativos agrupados salen en un solo mensaje (env:1, env:2 y env:3)');
select is((select (j -> 0 ->> 'silencioso')::boolean from _lote2), (extract(hour from (now() at time zone 'America/Merida')) >= 22 or extract(hour from (now() at time zone 'America/Merida')) < 7), 'horario silencioso 22:00 a 07:00 de Merida');
select ok((select count(*) = 3 from notificacion.entrega where estado = 'enviando' and canal = 'telegram'), 'los tres miembros quedan en envio');
select notificacion.registrar_resultado(pg_temp.entrega('env:1'), 'ok', 200, null, null, '4402');
select notificacion.registrar_resultado(pg_temp.entrega('env:2'), 'ok', 200, null, null, '4402');
select notificacion.registrar_resultado(pg_temp.entrega('env:3'), 'ok', 200, null, null, '4402');

-- Reintentos: 429 no gasta intento; 5xx con backoff 30, 60, 120, 240 y luego 1 h; 5 intentos => muerta ------------------------------------------
select pg_temp.av('paquete_enviado_con_guia', 'r:1', 11);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:1');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:1'), '429', 429, 17), 'pendiente', '10: 429 vuelve a la cola');
select is((select intentos from notificacion.entrega where id = pg_temp.entrega('r:1')), 0, '429 espera retry_after sin gastar intento');
select is((select siguiente_intento_at from notificacion.entrega where id = pg_temp.entrega('r:1')), now() + interval '17 seconds', 'espera exactamente retry_after');
do $$
declare v_e bigint; v_esp int[] := array[30, 60, 120, 240]; i int;
begin
  select e.id into v_e from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.clave_dedupe = 'r:1' and e.canal = 'telegram';
  for i in 1..4 loop
    update notificacion.entrega set siguiente_intento_at = now() where id = v_e;
    perform notificacion.reclamar_entregas(10, 120);
    perform notificacion.registrar_resultado(v_e, '5xx', 502, null, 'http_502');
    if (select siguiente_intento_at from notificacion.entrega where id = v_e) <> now() + make_interval(secs => v_esp[i]) then raise exception 'backoff % incorrecto', i; end if;
  end loop;
end $$;
select is((select intentos from notificacion.entrega where id = pg_temp.entrega('r:1')), 4, 'cuatro intentos fallidos con backoff 30, 60, 120 y 240 s');
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:1');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:1'), '5xx', 502, null, 'http_502'), 'muerta', 'al quinto intento la entrega muere');
select is((select codigo_error from notificacion.entrega where id = pg_temp.entrega('r:1')), 'http_502', 'con su codigo de error (sin contenido)');
select is((select count(*)::int from operacion.aviso where codigo = 'telegram_entrega_muerta' and estado = 'abierta'), 1, 'y se avisa una vez al dia que un aviso no salio por Telegram');
select is((select count(*)::int from notificacion.entrega_intento where entrega_id = pg_temp.entrega('r:1')), 6, 'cada intento queda en el registro de solo insercion');
select throws_ok($$ update notificacion.entrega_intento set codigo = 'x' where true $$, '42501', null, 'los intentos no se editan');

select pg_temp.limpiar();
-- 403 y migracion de chat; incierta ----------------------------------------------------------------------------------------------------------
select pg_temp.av('paquete_enviado_con_guia', 'r:2', 12);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:2');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:2'), '403', 403), 'muerta', '403 => muerta sin destino');
select is((select codigo_error from notificacion.entrega where id = pg_temp.entrega('r:2')), 'sin_destino', 'sin_destino');
select pg_temp.av('paquete_enviado_con_guia', 'r:3', 13);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:3');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:3'), '400_migrar', 400, null, null, null, false, -1001234567890), 'pendiente', '400 con migrate_to_chat_id reintenta');
select is((select telegram_chat_id from notificacion.destino where clave = 'grupo_socios'), -1001234567890::bigint, 'y actualiza el chat del grupo');
update notificacion.entrega set siguiente_intento_at = now() + interval '1 hour' where id = pg_temp.entrega('r:3');
-- tarjeta con accion: incierta => se reenvia; informativo: incierta se queda
select pg_temp.av('paquete_por_empacar', 'r:4', 14);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:4');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:4'), 'red', null, null, 'timeout', null, true), 'pendiente', '9: una tarjeta con accion incierta se reenvia');
select is((select reenvio from notificacion.entrega where id = pg_temp.entrega('r:4')), true, 'marcada como reenvio');
update notificacion.entrega set estado = 'omitida', codigo_error = 'limpieza' where id = pg_temp.entrega('r:4');
update notificacion.entrega set intentos = 4, siguiente_intento_at = now() where id = pg_temp.entrega('r:3');
select notificacion.reclamar_entregas(10, 120);
select is(notificacion.registrar_resultado(pg_temp.entrega('r:3'), 'red', null, null, 'timeout', null, true), 'incierta', 'un informativo incierto no se reenvia');
-- lease vencido
select pg_temp.av('paquete_enviado_con_guia', 'r:5', 15);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:5');
select notificacion.reclamar_entregas(10, 120);
update notificacion.entrega set lease_hasta = now() - interval '1 second' where id = pg_temp.entrega('r:5');
select notificacion.reclamar_entregas(10, 120);
select is((select estado from notificacion.entrega where id = pg_temp.entrega('r:5')), 'incierta', 'lease vencido de un informativo => incierta');
-- tarjeta con accion ya resuelta: no se envia
select pg_temp.av('paquete_por_empacar', 'r:6', 16);
select operacion.resolver_avisos('paquete_por_empacar', 'pedido', 16);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('r:6');
select notificacion.reclamar_entregas(10, 120);
select is((select estado from notificacion.entrega where id = pg_temp.entrega('r:6')), 'omitida', 'una tarjeta con accion cuyo asunto ya se resolvio pasa a omitida');
select is((select codigo_error from notificacion.entrega where id = pg_temp.entrega('r:6')), 'ya_resuelta', 'por ya_resuelta');

-- Interruptores y pausa ---------------------------------------------------------------------------------------------------------------------
select pg_temp.av('paquete_enviado_con_guia', 'p:1', 21);
update notificacion.entrega set siguiente_intento_at = now() where id = pg_temp.entrega('p:1');
update seguridad.interruptor set activo = true where clave = 'cron_pausado';
select is(jsonb_array_length(notificacion.reclamar_entregas(10, 120)), 0, 'con cron_pausado nada sale');
update seguridad.interruptor set activo = false where clave = 'cron_pausado';
update seguridad.interruptor set activo = false where clave = 'telegram_envio';
select is(jsonb_array_length(notificacion.reclamar_entregas(10, 120)), 0, 'con telegram_envio apagado no se reclama nada de Telegram');
update seguridad.interruptor set activo = true where clave = 'telegram_envio';

-- Presupuesto por hora (12 informativos) y freno de tormenta (40) -------------------------------------------------------------------------------
update notificacion.entrega set estado = 'omitida', codigo_error = 'limpieza' where estado in ('pendiente', 'enviando', 'incierta');
do $$
declare i int; v_a bigint;
begin
  -- doce informativos ya enviados esta hora (en entregas sinteticas de avisos distintos)
  for i in 1..12 loop
    v_a := operacion.avisar('paquete_enviado_con_guia', null, 'pres:' || i, null, 'p', 'pedido', 100 + i, '{}'::jsonb);
    update notificacion.entrega set estado = 'enviada', enviada_at = now(), grupo_clave = null where notificacion_id = v_a and canal = 'telegram';
  end loop;
  v_a := operacion.avisar('paquete_enviado_con_guia', null, 'pres:13', null, 'p', 'pedido', 113, '{}'::jsonb);
  update notificacion.entrega set siguiente_intento_at = now(), grupo_clave = null where notificacion_id = v_a and canal = 'telegram';
end $$;
select is(jsonb_array_length(notificacion.reclamar_entregas(10, 120)), 0, '14: el informativo 13 de la hora no sale (presupuesto de 12)');
select ok((select siguiente_intento_at >= date_trunc('hour', now()) + interval '1 hour' from notificacion.entrega where id = pg_temp.entrega('pres:13')), 'espera a la hora siguiente');
-- tormenta: mas de 40 mensajes en una hora detienen los individuales y sale un aviso
do $$
declare i int; v_a bigint;
begin
  for i in 14..45 loop
    v_a := operacion.avisar('paquete_enviado_con_guia', null, 'pres:' || i, null, 'p', 'pedido', 100 + i, '{}'::jsonb);
    update notificacion.entrega set estado = 'enviada', enviada_at = now(), grupo_clave = null where notificacion_id = v_a and canal = 'telegram';
  end loop;
  v_a := operacion.avisar('paquete_enviado_con_guia', null, 'tor:1', null, 'p', 'pedido', 200, '{}'::jsonb);
end $$;
select notificacion.reclamar_entregas(10, 120);
select is((select codigo_error from notificacion.entrega where id = pg_temp.entrega('tor:1')), 'freno_tormenta', '14: pasadas 40 entregas en una hora se detienen los individuales');
select is((select count(*)::int from operacion.aviso where codigo = 'freno_tormenta'), 1, 'y sale un solo aviso de eventos agrupados');

-- Tokens de un solo uso para botones ------------------------------------------------------------------------------------------------------------
insert into notificacion.miembro (telegram_user_id, rol) values (1001, 'socio'), (1002, 'socio'), (2001, 'omar');
select pg_temp.av('toma_omar_pendiente', 'tk:1', 7);
create temp table _tk on commit drop as select
  notificacion.crear_token((select id from operacion.aviso where clave_dedupe = 'tk:1'), 'autorizar_toma', array['socio'], -100, 'toma:7') as aut,
  notificacion.crear_token((select id from operacion.aviso where clave_dedupe = 'tk:1'), 'rechazar_toma', array['socio'], -100, 'toma:7') as rec;
select matches((select aut from _tk), '^[0-9A-Za-z]{10}$', 'el token tiene 10 caracteres alfanumericos (callback_data de menos de 64 bytes)');
select is((select length('n:' || aut) from _tk), 12, 'callback_data = n: + token, nunca monto ni folio');
select is((select notificacion.consumir_token(aut, 2001, -100, 'cb-1') ->> 'motivo' from _tk), 'no_autorizado', '12: Omar no puede pulsar botones de socios');
select is((select notificacion.consumir_token(aut, 999, -100, 'cb-2') ->> 'motivo' from _tk), 'no_autorizado', 'un ajeno tampoco');
select is((select notificacion.consumir_token(aut, 1001, -999, 'cb-3') ->> 'motivo' from _tk), 'chat_distinto', 'una tarjeta reenviada a otro chat se anula');
select is((select usado_at is null from notificacion.accion_token where token = (select aut from _tk)), true, 'ninguno de esos rechazos consumio el token');
select is((select notificacion.consumir_token(aut, 1001, -100, 'cb-4') ->> 'motivo' from _tk), 'ok', 'el socio autorizado pulsa Autorizar');
select is((select notificacion.consumir_token(aut, 1001, -100, 'cb-4') ->> 'motivo' from _tk), 'ok', '8: el mismo callback repetido devuelve lo mismo (idempotente)');
select is((select count(*)::int from notificacion.pulsacion where resultado = 'ok'), 1, 'y se audita una sola vez');
select is((select notificacion.consumir_token(aut, 1002, -100, 'cb-5') ->> 'motivo' from _tk), 'ya_usado', '12: el segundo socio que pulsa lo mismo recibe ya_usado');
select is((select notificacion.consumir_token(rec, 1002, -100, 'cb-6') ->> 'motivo' from _tk), 'invalidado', '12: Rechazar tras Autorizar esta invalidado (mismo grupo exclusivo)');
-- caducidad y version
select pg_temp.av('toma_omar_pendiente', 'tk:2', 8);
create temp table _tk2 on commit drop as select notificacion.crear_token((select id from operacion.aviso where clave_dedupe = 'tk:2'), 'autorizar_toma', array['socio'], -100) as t1,
  notificacion.crear_token((select id from operacion.aviso where clave_dedupe = 'tk:2'), 'deshacer', array['socio'], -100) as t2;
select is((select expira_at - now() from notificacion.accion_token where token = (select t1 from _tk2)), interval '72 hours', 'las tomas caducan a las 72 h');
select is((select (expira_at - now()) from notificacion.accion_token where token = (select t2 from _tk2)), interval '10 minutes', 'Deshacer caduca a los 10 min');
update notificacion.accion_token set expira_at = now() - interval '1 second' where token = (select t1 from _tk2);
select is((select notificacion.consumir_token(t1, 1001, -100, 'cb-7') ->> 'motivo' from _tk2), 'caducado', 'token vencido: rechazo sin cambios');
update operacion.aviso set version = version + 1 where clave_dedupe = 'tk:2';
select is((select notificacion.consumir_token(t2, 1001, -100, 'cb-8') ->> 'motivo' from _tk2), 'tarjeta_cambio', 'token de version vieja: la tarjeta cambio');
select pg_temp.av('toma_omar_pendiente', 'tk:3', 9);
update operacion.aviso set estado = 'resuelta' where clave_dedupe = 'tk:3';
select is(notificacion.consumir_token(notificacion.crear_token((select id from operacion.aviso where clave_dedupe = 'tk:3'), 'autorizar_toma', array['socio'], -100), 1001, -100, 'cb-9') ->> 'motivo', 'ya_resuelta', 'si otro la resolvio por la web, la pulsacion dice ya_resuelta');
-- limite de 10 pulsaciones por minuto
do $$ declare i int; begin for i in 1..12 loop perform notificacion.consumir_token('desconocido' || i, 1002, -100, 'rl-' || i); end loop; end $$;
select is(notificacion.consumir_token('otro', 1002, -100, 'rl-99') ->> 'motivo', 'limite', 'mas de 10 pulsaciones por minuto por usuario se rechazan');
select throws_ok($$ select notificacion.crear_token(1, 'x', array['socio'], 1) $$, null, null, 'con el rol de la web no hay forma de crear tokens') ;

-- La web no puede llamar al despacho ----------------------------------------------------------------------------------------------------------
set local role authenticated;
select throws_ok($$ select notificacion.reclamar_entregas(1, 1) $$, '42501', null, 'authenticated no ejecuta el despacho');
select throws_ok($$ select notificacion.consumir_token('x', 1, 1, 'x') $$, '42501', null, 'authenticated no consume tokens');
reset role;

-- Caducidad ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.av('paquete_enviado_con_guia', 'cad:1', 31);
update operacion.aviso set caduca_at = now() - interval '1 second' where clave_dedupe = 'cad:1';
select ok(notificacion.caducar_vencidas() >= 1, '13: los asuntos pasan a caducada en su ttl');
select is((select estado from operacion.aviso where clave_dedupe = 'cad:1'), 'caducada', 'caducada');
select is((select caduca_at is null from operacion.aviso where clave_dedupe = 'cuenta_proveedor_no_cuadra:comprobacion:7:1' or clave_dedupe = 'cr:1' limit 1), true, 'los criticos no caducan');
select is((select (caduca_at - creado_at) from operacion.aviso where clave_dedupe = 'pe:1'), interval '30 days', 'importantes: 30 dias');
select is((select (caduca_at - creado_at) from operacion.aviso where clave_dedupe = 'env:1'), interval '7 days', 'informativos: 7 dias');

-- Respaldo por correo con Telegram caido --------------------------------------------------------------------------------------------------------
select pg_temp.av('cuenta_proveedor_no_cuadra', 'resp:1');
update notificacion.entrega set creada_at = now() - interval '3 hours' where id = pg_temp.entrega('resp:1');
update notificacion.entrega set estado = 'muerta', codigo_error = 'http_502' where id = pg_temp.entrega('resp:1');
delete from notificacion.entrega where notificacion_id = (select id from operacion.aviso where clave_dedupe = 'resp:1') and canal = 'correo';
select is(notificacion.respaldo_correo(), 1, '11: con Telegram caido mas de 2 h sale un correo de una linea');
select is(notificacion.respaldo_correo(), 0, 'maximo uno por hora');
select is((select count(*)::int from notificacion.entrega where codigo_error = 'respaldo' and canal = 'correo'), 1, 'un solo correo de respaldo');

-- Evaluadores ----------------------------------------------------------------------------------------------------------------------------------
select is((select (notificacion.evaluar(negocio.hoy()) ->> 'emitidas')::int), (select count(*)::int from contabilidad.comprobaciones() where not ok and codigo in ('C2', 'C6', 'C7', 'C8', 'C9', 'C17')), 'sin hechos nuevos, el evaluador emite solo por comprobaciones en rojo');
select notificacion.emitir_recurrente('comprobacion_dinero_falla', 'comprobacion', 99, 'Prueba de comprobacion', '{"comprobacion": "C99"}'::jsonb);
select notificacion.emitir_recurrente('comprobacion_dinero_falla', 'comprobacion', 99, 'Prueba de comprobacion', '{"comprobacion": "C99"}'::jsonb);
select is((select count(*)::int from operacion.aviso where codigo = 'comprobacion_dinero_falla' and entidad_id = 99), 1, 'NT-067: una sola fila abierta por comprobacion');
select is((select conteo from operacion.aviso where codigo = 'comprobacion_dinero_falla' and entidad_id = 99), 2, 'y cada pasada solo sube el conteo');
select is((select severidad from operacion.aviso where codigo = 'comprobacion_dinero_falla' and entidad_id = 99), 'C', 'critica (catalogo)');
select operacion.resolver_avisos('comprobacion_dinero_falla', 'comprobacion', 99);
select notificacion.emitir_recurrente('comprobacion_dinero_falla', 'comprobacion', 99, 'Prueba de comprobacion', '{"comprobacion": "C99"}'::jsonb);
select is((select count(*)::int from operacion.aviso where codigo = 'comprobacion_dinero_falla' and entidad_id = 99), 2, 'si vuelve a fallar tras resolverse, nace un asunto nuevo');
-- NT-028 y NT-027 con la cuenta de Karen
select operacion.registrar_ajuste_proveedor('f3b2:karen-neg', 'Karen', -50000, 'descuento_proveedor', 'prueba de saldo negativo');
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'saldo_negativo_karen' and estado = 'abierta'), 1, 'NT-028: se le debe a Karen');
insert into notificacion.estado_evaluador (clave, valor) values ('signo_proveedor:' || catalogo.proveedor_id('Karen'), '1'::jsonb) on conflict (clave) do update set valor = '1'::jsonb;
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'saldo_proveedor_cruza_cero'), 1, 'NT-027: el saldo cruzo cero (de a favor a deuda)');
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'saldo_proveedor_cruza_cero'), 1, 'sin otro cruce no se repite');
select operacion.registrar_ajuste_proveedor('f3b2:karen-pos', 'Karen', 80000, 'saldo_a_favor', 'prueba para volver a favor');
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'saldo_negativo_karen' and estado = 'abierta'), 0, 'NT-028 se resuelve sola cuando el saldo deja de ser negativo');
-- NT-041
insert into notificacion.estado_evaluador (clave, valor) values ('posicion_socios', '0'::jsonb) on conflict (clave) do update set valor = '0'::jsonb;
select operacion.registrar_aportacion('f3b2:ap', 'Angelo', 700000, 'prueba de posicion', 'capital', negocio.hoy());
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'posicion_socios_cambia'), 1, 'NT-041: la posicion cambio mas de 5,000 pesos');
select notificacion.evaluar(negocio.hoy());
select is((select count(*)::int from operacion.aviso where codigo = 'posicion_socios_cambia'), 1, 'maximo uno al dia');

-- Triggers: periodos (NT-047) y altas de acceso (NT-095) --------------------------------------------------------------------------------------
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3b.notif.c@example.test', 'socio', 'Angelo', false);
select is((select count(*)::int from operacion.aviso where codigo = 'usuario_alta_o_rol'), (select count(*)::int from operacion.aviso where codigo = 'usuario_alta_o_rol' and severidad = 'I'), 'NT-095: un alta de usuario es informativa (auditoria 14-nov)');
select ok((select count(*) from operacion.aviso where codigo = 'usuario_alta_o_rol') >= 1, 'y deja el aviso');
select is((select payload::text from operacion.aviso where codigo = 'usuario_alta_o_rol' order by id desc limit 1), '{"rol": "socio", "activo": false}', 'sin el correo ni datos personales en el aviso');
select is((select count(*)::int from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id where a.codigo = 'usuario_alta_o_rol' and e.canal = 'telegram'), 0, 'nunca por Telegram');
insert into contabilidad.periodo (tipo, ini, fin, estado) values ('semana', date '2030-01-07', date '2030-01-13', 'preparado');
update contabilidad.periodo set estado = 'aprobado', aprobado_at = now() where tipo = 'semana' and ini = date '2030-01-07';
select is((select count(*)::int from operacion.aviso where codigo = 'accion_fuerte_o_periodo' and payload ->> 'estado' = 'aprobado'), 1, 'NT-047: aprobar un periodo avisa al otro socio');

-- Campana, Tu turno y pulso --------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '74444444-4444-4444-4444-444444444442', true);
select ok((api.mis_notificaciones('todas', 0) -> 'notificaciones') is not null, 'la campana lista las notificaciones');
select is(api.contar_no_leidas(), (select count(*)::int from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo cross join lateral notificacion.condicion(a) k where a.estado = 'abierta' and k.vigente is not false and t.canal not in ('OM', 'VO')), 'contar_no_leidas = abiertas vigentes sin marca de lectura');
select ok(api.contar_no_leidas() > 0, 'hay avisos sin leer');
select ok(jsonb_array_length(api.mis_notificaciones('sin_leer', 0) -> 'notificaciones') <= 25, 'paginas de 25');
select ok(not exists (select 1 from jsonb_array_elements(api.mis_notificaciones('sin_leer', 0) -> 'notificaciones') n where (n ->> 'leida')::boolean), 'la pestana Sin leer solo trae lo no leido');
select pg_temp.av('aviso_precio_tabulador', 'tt:1', 1);
select api.marcar_leida((select id from operacion.aviso where clave_dedupe = 'tt:1'));
select is((select leida_at is not null from notificacion.destinatario where aviso_id = (select id from operacion.aviso where clave_dedupe = 'tt:1') and usuario_id = '74444444-4444-4444-4444-444444444442'), true, 'marcar leida');
select is((select estado from operacion.aviso where clave_dedupe = 'tt:1'), 'abierta', 'leida y resuelta son independientes: sigue abierta');
select ok(exists (select 1 from jsonb_array_elements(api.tu_turno() -> 'items') i where i ->> 'codigo' = 'aviso_precio_tabulador'), 'un asunto abierto con accion sigue en Tu turno aunque este leido');
select ok(not exists (select 1 from jsonb_array_elements(api.tu_turno() -> 'items') i where i ->> 'codigo' = 'paquete_enviado_con_guia'), 'lo informativo no entra en Tu turno');
select ok(exists (select 1 from generate_series(0, 8) p, jsonb_array_elements(api.mis_notificaciones('todas', p) -> 'notificaciones') n where (n ->> 'telegram_no_salio')::boolean), 'la campana dice "Telegram no salio" cuando la entrega murio y el asunto sigue abierto');
select api.marcar_todas_leidas();
select is(api.contar_no_leidas(), 0, 'marcar todo como leido');
select is((select count(*)::int from notificacion.destinatario d where d.usuario_id = '74444444-4444-4444-4444-444444444441' and d.leida_at is not null), 0, 'cada socio tiene su propia lectura');
select ok((api.pulso() -> 'por_cobrar_cent') = 'null'::jsonb, 'sin pedidos enviados, Por cobrar dice Sin dato (null), no cero');
select ok((api.pulso() -> 'en_bodega') = 'null'::jsonb, 'sin movimientos, En bodega dice Sin dato');
select ok((api.pulso() -> 'entre_socios') <> 'null'::jsonb, 'con una aportacion registrada, Entre socios ya tiene dato');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$ select api.mis_notificaciones('todas', 0) $$, '42501', null, 'sin ser socio no se lee la campana');

select * from finish();
rollback;
