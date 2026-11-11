-- pgTAP: registro cerrado en el servidor y rol/activo desde la tabla. Correos ficticios (@example.test).
begin;
select plan(10);

-- La auditoria es de solo insercion y persiste entre corridas: se compara contra el conteo inicial.
create temp table _n0 as select count(*)::int as n from seguridad.auditoria where tabla = 'seguridad.usuario' and accion = 'INSERT';

-- Un correo fuera de la lista no puede crear usuario en auth.users (defensa adicional a enable_signup = false) ----------
select throws_ok(
  $$insert into auth.users (id, instance_id, aud, role, email) values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'intruso@example.test')$$,
  '42501', 'registro cerrado: correo no permitido', 'auth.users rechaza un correo fuera de la lista');
select is((select count(*)::int from auth.users where email = 'intruso@example.test'), 0, 'no quedo ningun usuario del intruso');

-- Un correo de la lista crea usuario y su fila de rol (inactiva por omision) -------------------------------------------------
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('socio.a@example.test', 'socio', 'Angelo', true);
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('omar.yacaman@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'socio.a@example.test');
insert into auth.users (id, instance_id, aud, role, email) values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Omar.Yacaman@Example.Test');

select is((select rol from seguridad.usuario where id = '11111111-1111-1111-1111-111111111111'), 'socio', 'el rol sale de la tabla');
select is((select socio_nombre from seguridad.usuario where id = '11111111-1111-1111-1111-111111111111'), 'Angelo', 'el socio sale de la tabla');
select is((select activo from seguridad.usuario where id = '22222222-2222-2222-2222-222222222222'), false, 'Omar nace con acceso desactivado');

-- Las altas quedan auditadas ------------------------------------------------------------------------------------------------------
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.usuario' and accion = 'INSERT') - (select n from _n0), 2, 'las dos altas de usuario quedaron en la auditoria');
select ok(seguridad.verificar_cadena_auditoria(), 'la cadena de auditoria sigue valida');

-- rol_actual / exigir_rol / mi_sesion con una sesion simulada -------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select is(seguridad.rol_actual(), 'socio', 'rol_actual del socio activo');
select lives_ok($$select seguridad.exigir_rol(array['socio'])$$, 'exigir_rol deja pasar al socio');
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select throws_ok($$select seguridad.exigir_rol(array['socio', 'omar'])$$, '42501', 'permiso denegado', 'un usuario inactivo no pasa exigir_rol aunque su rol este en la lista');

select * from finish();
rollback;
