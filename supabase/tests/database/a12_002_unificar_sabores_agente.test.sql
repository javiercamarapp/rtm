-- pgTAP a12_002: puertas del agente de Telegram para la unificacion de sabores (el socio verificado contesta si o no; el aviso al grupo y deshacer salen de la base).
begin;
-- Carril frenos: el interruptor agente_escritura nace apagado; esta prueba ejerce las puertas de escritura.
update seguridad.interruptor set activo = true where clave = 'agente_escritura';
select no_plan();
update catalogo.config set vigente_desde = '2020-01-01' where vigente_desde > '2020-01-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('ug.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('99999999-9999-9999-9999-9999999999a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ug.jav@example.test');
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-9999999999a1', true);
select agente.registrar_miembro(5100001, 'angelo');
select agente.registrar_miembro(5100002, 'javier');
select agente.registrar_miembro(5100003, 'omar');
select catalogo.asegurar_modelo('UG Marca', 'UG Blade', 50000, 'ambas');
select catalogo.asegurar_sku('UG Blade', s) from unnest(array['Passionfruit', 'Passion Fruit', 'Lychee', 'Lychee Ice', 'Mango']) s;
select catalogo.escanear_duplicados('sabor');
-- Desde aqui actua el servidor del bot: sin sesion de usuario; el socio lo da el autor verificado.
select set_config('request.jwt.claim.sub', '', true);

select is(agente.sabor_pregunta() ->> 'clase', 'IGUAL_NORMALIZADO', 'la pregunta mas fuerte va primero');
select is(agente.sabor_pregunta() ->> 'pregunta', '¿"Passionfruit" es lo mismo que "Passion Fruit"?', 'texto del servidor');
create temp table _p as select (agente.sabor_pregunta() ->> 'pregunta_id')::bigint as id;
grant all on _p to public;
select throws_ok($$select agente.sabor_responder('ug-0', '{"pregunta_id":1,"respuesta":"si"}')$$, 'P0460', null, 'sin autor no se contesta');
select throws_ok($$select agente.sabor_responder('ug-1', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'si', 'autor', 'angelo', 'telegram_user_id', 5100002))$$, null, null, 'el id de Telegram debe ser el del autor declarado');
select throws_ok($$select agente.sabor_responder('ug-2', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'si', 'autor', 'omar', 'telegram_user_id', 5100003))$$, 'P0460', null, 'Omar no contesta');
select throws_ok($$select agente.sabor_responder('ug-3', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'quiza', 'autor', 'angelo', 'telegram_user_id', 5100001))$$, 'P0460', null, 'solo si o no');
select is((select count(*)::int from catalogo.sabor where unificado_en is not null), 0, 'nada se unio todavia');

select is(agente.sabor_responder('ug-4', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'si', 'autor', 'angelo', 'telegram_user_id', 5100001)) ->> 'estado', 'unificado', 'Angelo dice que si: se unifica');
select ok((agente.sabor_responder('ug-4', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'si', 'autor', 'angelo', 'telegram_user_id', 5100001)) ->> 'aviso_grupo') like 'Angelo unió los sabores%', 'aviso para el grupo (misma clave: idempotente)');
select is((select canal from catalogo.posible_duplicado where id = (select id from _p)), 'telegram', 'queda el canal telegram');
select is((select count(*)::int from seguridad.auditoria where accion = 'UNIFICACION' and despues ->> 'origen_canal' = 'telegram'), 1, 'auditoria con origen telegram');
select is(agente.sabor_deshacer('ug-5', jsonb_build_object('autor', 'javier', 'telegram_user_id', 5100002)) ->> 'estado', 'deshecha', 'Javier deshace la ultima union');
select is((select count(*)::int from catalogo.sabor where unificado_en is not null), 0, 'vuelve a estar todo como antes');

select is(agente.sabor_responder('ug-6', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'no', 'autor', 'javier', 'telegram_user_id', 5100002)) ->> 'estado', 'distinto', 'Javier dice que no: negativo');
select ok((agente.sabor_responder('ug-6', jsonb_build_object('pregunta_id', (select id from _p), 'respuesta', 'no', 'autor', 'javier', 'telegram_user_id', 5100002)) ->> 'aviso_grupo') like 'Javier confirmó%distintos%', 'aviso al grupo del negativo');
select isnt(agente.sabor_pregunta() ->> 'pregunta', '¿"Passionfruit" es lo mismo que "Passion Fruit"?', 'esa pregunta no vuelve');
select ok(not has_function_privilege('authenticated', 'agente.sabor_responder(text,jsonb)', 'execute') and not has_function_privilege('anon', 'agente.sabor_pregunta()', 'execute'), 'solo el rol servidor');
select * from finish();
rollback;
