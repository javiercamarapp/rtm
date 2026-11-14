-- pgTAP a11_002: cambiar el correo de una cuenta de bodega. Desactiva el acceso anterior (corta sesiones), crea el nuevo del mismo tipo y nombre, validacion y forma canonica
-- iguales al alta, tope de 20, idempotencia, auditoria con huella (nunca el correo), solo socio, nunca socio ni Omar.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('c112.socio@example.test', 'socio', 'Javier', true), ('c112.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('c1120000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c112.socio@example.test'),
  ('c1120000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c112.omar@example.test');
select set_config('request.jwt.claim.sub', 'c1120000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(api.cuenta_alta('c112-a1', 'c112.provisional@example.test', 'bodega', 'Turno Manana') ->> 'estado', 'creada', 'cuenta provisional creada');
reset role;
-- La cuenta provisional ya tiene acceso y una sesion abierta.
insert into auth.users (id, instance_id, aud, role, email) values ('c1120000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c112.provisional@example.test');
insert into seguridad.usuario (id, rol, activo) values ('c1120000-0000-0000-0000-000000000010', 'bodega', true) on conflict (id) do update set activo = true;
insert into auth.sessions (id, user_id) values ('c1120000-0000-0000-0000-0000000000a1', 'c1120000-0000-0000-0000-000000000010');
set local role authenticated;

select is(api.cuenta_cambiar_correo('c112-k1', 'c112.provisional@example.test', 'C112.Definitivo@Example.test', 'cambia de turno') ->> 'estado', 'cambiada', 'el cambio funciona (el correo nuevo se acepta en cualquier capitalizacion)');
reset role;
select is((select activo from seguridad.correo_permitido where correo = 'c112.provisional@example.test'), false, 'el correo anterior queda desactivado');
select is((select activo from seguridad.correo_permitido where correo = 'c112.definitivo@example.test'), true, 'el nuevo queda activo (forma canonica)');
select is((select rol || '|' || coalesce(nombre, '') from seguridad.correo_permitido where correo = 'c112.definitivo@example.test'), 'bodega|Turno Manana', 'mismo tipo y mismo nombre');
select is((select count(*)::int from auth.sessions where user_id = 'c1120000-0000-0000-0000-000000000010'), 0, 'se cortaron las sesiones del acceso anterior');
select is((select activo from seguridad.usuario where id = 'c1120000-0000-0000-0000-000000000010'), false, 'el usuario anterior queda inactivo (no entra aunque pida enlace)');
select is((select count(*)::int from seguridad.correo_permitido where correo ~ '^c112\.(provisional|definitivo)'), 2, 'la anterior se conserva (auditoria e historial), no se borra');
-- Auditoria sin correo en claro.
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and (coalesce(antes::text, '') || coalesce(despues::text, '') || coalesce(registro_id, '')) ilike '%c112.%'), 0, 'la auditoria no trae el correo en claro');
select ok((select count(*) from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and despues ->> 'cambio_de_correo_a' is not null) = 1, 'la auditoria del retiro trae la huella del correo nuevo');
select ok((select count(*) from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and despues ->> 'reemplaza_a' is not null) = 1, 'y la del alta trae la huella del anterior');
select is((select count(*)::int from seguridad.operacion where resultado::text ilike '%@%'), 0, 'seguridad.operacion no guarda correos');
-- Auth del correo nuevo: aun no existe; el script acceso:cuentas lo crea (selecciona toda cuenta creable activa sin usuario de Auth).
select is((select count(*)::int from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol where t.creable_web and c.activo and c.correo = 'c112.definitivo@example.test'
            and not exists (select 1 from auth.users u where lower(u.email) = c.correo)), 1, 'el correo nuevo aparece como pendiente de crear en Auth (lo toma acceso:cuentas)');

set local role authenticated;
-- Idempotencia: misma clave = mismo resultado; otra clave con el cambio ya hecho = sin_cambio.
select is((api.cuenta_cambiar_correo('c112-k1', 'c112.provisional@example.test', 'c112.definitivo@example.test', 'cambia de turno') ->> 'repetido')::boolean, true, 'misma clave: se repite el resultado');
select is(api.cuenta_cambiar_correo('c112-k2', 'c112.provisional@example.test', 'c112.definitivo@example.test') ->> 'estado', 'sin_cambio', 'otra clave con el cambio ya hecho: sin cambio');
reset role;
select is((select count(*)::int from seguridad.correo_permitido where correo like 'c112.%'), 4, 'no se duplico ninguna fila');
set local role authenticated;

-- Validaciones y conflictos.
select throws_ok($$select api.cuenta_cambiar_correo('c112-v1', 'c112.definitivo@example.test', 'no es correo')$$, '22023', null, 'correo nuevo invalido');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v2', 'c112.definitivo@example.test', 'C112.DEFINITIVO@example.test.')$$, '22023', null, 'igual al actual (forma canonica)');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v3', 'c112.definitivo@example.test', 'c112.socio@example.test')$$, '23505', null, 'el correo nuevo ya es de un socio: conflicto');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v4', 'c112.noexiste@example.test', 'c112.x@example.test')$$, '22023', null, 'cuenta desconocida');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v5', 'c112.socio@example.test', 'c112.x@example.test')$$, '42501', null, 'nunca la cuenta de un socio');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v6', 'c112.omar@example.test', 'c112.x@example.test')$$, '42501', null, 'ni la de Omar');
select throws_ok($$select api.cuenta_cambiar_correo('c112-v7', 'c112.provisional@example.test', 'c112.y@example.test')$$, '22023', null, 'la cuenta desactivada no se cambia: primero se reactiva');
select throws_ok($$select api.cuenta_cambiar_correo('', 'c112.definitivo@example.test', 'c112.z@example.test')$$, '22023', null, 'sin clave de idempotencia');

-- Tope de 20 cuentas activas: el cambio no lo evade (la anterior deja de contar, la nueva cuenta).
reset role;
insert into seguridad.correo_permitido (correo, rol, activo) select 'c112.fill' || g || '@example.test', 'bodega', true from generate_series(1, 19) g;
select is((select count(*)::int from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol where t.creable_web and c.activo), 20, 'hay 20 activas');
set local role authenticated;
select is(api.cuenta_cambiar_correo('c112-t1', 'c112.fill1@example.test', 'c112.fill1b@example.test') ->> 'estado', 'cambiada', 'con 20 activas el cambio es neutro (una sale, una entra)');
reset role;
select is((select count(*)::int from seguridad.correo_permitido c join seguridad.tipo_cuenta t on t.rol = c.rol where t.creable_web and c.activo), 20, 'siguen 20 activas');

-- Solo socio; anon y bodega fuera.
select ok(not has_function_privilege('anon', 'api.cuenta_cambiar_correo(text,text,text,text)', 'execute') and not has_function_privilege('public', 'api.cuenta_cambiar_correo(text,text,text,text)', 'execute'), 'anon y PUBLIC sin EXECUTE');
select set_config('request.jwt.claim.sub', 'c1120000-0000-0000-0000-000000000002', true);
set local role authenticated;
select throws_ok($$select api.cuenta_cambiar_correo('c112-o1', 'c112.definitivo@example.test', 'c112.w@example.test')$$, null, null, 'Omar no puede');
reset role;
select * from finish();
rollback;
