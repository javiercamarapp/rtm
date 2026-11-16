-- pgTAP a8_001: rol 'bodega' y pantalla de Cuentas (solo socio). Alta de un correo con tipo, idempotencia, auditoria sin correo, sin escalada de privilegios
-- (nunca socio ni importacion desde la web; omar y bodega si), desactivar y reactivar sin borrar, y que bodega/omar/anon no puedan administrar cuentas. Datos sinteticos (example.test).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('b8.socio@example.test', 'socio', 'Javier', true), ('b8.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('b8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b8.socio@example.test'),
  ('b8000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b8.omar@example.test');
create function pg_temp.como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce($1::text, ''), true) $$;

-- Catalogo ---------------------------------------------------------------------------------------------------------------------
select is((select string_agg(rol, ',' order by rol) from seguridad.tipo_cuenta where creable_web), 'bodega,omar', 'solo bodega y omar (bajo privilegio) son creables desde la web');
select throws_ok($$insert into seguridad.tipo_cuenta (rol, etiqueta, descripcion, creable_web) values ('socio', 'x', 'x', true)$$, '23514', null, 'el catalogo no admite marcar socio como creable desde la web');
select throws_ok($$insert into seguridad.tipo_cuenta (rol, etiqueta, descripcion, creable_web) values ('importacion', 'x', 'x', true)$$, '23514', null, 'ni importacion');
select throws_ok($$insert into seguridad.correo_permitido (correo, rol, activo) values ('b8.raro@example.test', 'dios', true)$$, '23503', null, 'un rol fuera del catalogo no entra a la lista de permitidos');

-- Socio da de alta un correo de bodega ----------------------------------------------------------------------------------------
select pg_temp.como('b8000000-0000-0000-0000-000000000001');
set local role authenticated;
select is(jsonb_array_length(api.cuentas_lista() -> 'tipos'), 3, 'cuentas_lista devuelve el catalogo de tipos');
select is((api.cuenta_alta('b8-a1', '  B8.Bodega@Example.TEST ', 'bodega', 'Turno matutino') ->> 'estado'), 'creada', 'alta de un correo de bodega');
select is((api.cuenta_alta('b8-a1', '  B8.Bodega@Example.TEST ', 'bodega', 'Turno matutino') ->> 'repetido')::boolean, true, 'misma clave y mismo payload: repetido, sin duplicar');
select throws_ok($$select api.cuenta_alta('b8-a1', 'otro@example.test', 'bodega')$$, 'P0409', null, 'misma clave con otro payload: conflicto de idempotencia');
select is((api.cuenta_alta('b8-a2', 'b8.bodega@example.test', 'bodega') ->> 'estado'), 'sin_cambio', 'mismo correo con otra clave: sin cambio (no duplica)');
select is((select count(*)::int from jsonb_array_elements(api.cuentas_lista() -> 'cuentas') c where c ->> 'correo' = 'b8.bodega@example.test'), 1, 'una sola fila del correo, en minusculas');
select is((select c ->> 'acceso_creado' from jsonb_array_elements(api.cuentas_lista() -> 'cuentas') c where c ->> 'correo' = 'b8.bodega@example.test'), 'false', 'sin usuario de Auth todavia: acceso pendiente');

-- Sin escalada de privilegios ----------------------------------------------------------------------------------------------------
select throws_ok($$select api.cuenta_alta('b8-e1', 'b8.escala1@example.test', 'socio')$$, '42501', null, 'no se crea un socio desde la web');
select is(api.cuenta_alta('b8-e2', 'b8.omar2@example.test', 'omar') ->> 'estado', 'creada', 'Omar (activo) si se da de alta desde la web');
select throws_ok($$select api.cuenta_alta('b8-e2b', 'b8.socio@example.test', 'omar')$$, '23505', null, 'un socio no se convierte en Omar (ni al reves)');
select throws_ok($$select api.cuenta_alta('b8-e3', 'b8.escala3@example.test', 'importacion')$$, '22023', null, 'importacion no es un tipo de cuenta');
select throws_ok($$select api.cuenta_alta('b8-e4', 'b8.socio@example.test', 'bodega')$$, '23505', null, 'un correo de socio no cambia de tipo (sin bajar ni subir)');
select throws_ok($$select api.cuenta_alta('b8-e5', 'b8.omar@example.test', 'bodega')$$, '23505', null, 'un correo de Omar tampoco cambia de tipo');
select throws_ok($$select api.cuenta_alta('b8-e6', 'no-es-correo', 'bodega')$$, '22023', null, 'correo invalido');
select throws_ok($$select api.cuenta_alta('', 'b8.x@example.test', 'bodega')$$, '22023', null, 'sin clave de idempotencia');
select throws_ok($$select api.cuenta_cambiar_estado('b8-e7', 'b8.socio@example.test', false)$$, '42501', null, 'no se desactiva un socio desde la web');
select is(api.cuenta_cambiar_estado('b8-e8', 'b8.omar2@example.test', false) ->> 'estado', 'desactivada', 'se desactiva una cuenta de Omar desde la web');
select throws_ok($$select api.cuenta_cambiar_estado('b8-e9', 'b8.nadie@example.test', false)$$, '22023', null, 'cuenta desconocida');
reset role;
select is((select rol from seguridad.correo_permitido where correo = 'b8.bodega@example.test'), 'bodega', 'queda como bodega');
select is((select socio_nombre from seguridad.correo_permitido where correo = 'b8.bodega@example.test'), null, 'sin socio_nombre');
select is((select count(*)::int from seguridad.correo_permitido where correo like 'b8.escala%'), 0, 'ningun intento de escalada dejo fila');

-- Auditoria: quien/que, sin el correo en claro --------------------------------------------------------------------------------------
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and accion = 'INSERT' and despues ->> 'rol' = 'bodega' and actor = 'b8000000-0000-0000-0000-000000000001'), 1, 'auditoria del alta con el actor');
select is((select count(*)::int from seguridad.auditoria where coalesce(despues::text, '') || coalesce(registro_id, '') ilike '%b8.bodega%'), 0, 'la auditoria no copia el correo');

-- El usuario de Auth se crea con el correo permitido: el trigger le pone el rol bodega, activo --------------------------------------------
insert into auth.users (id, instance_id, aud, role, email) values ('b8000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b8.bodega@example.test');
select is((select rol || ':' || activo::text from seguridad.usuario where id = 'b8000000-0000-0000-0000-000000000003'), 'bodega:true', 'usuario de bodega activo con rol de la tabla');
select throws_ok($$insert into auth.users (id, instance_id, aud, role, email) values ('b8000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b8.intruso@example.test')$$, '42501', null, 'un correo no permitido no entra (registro cerrado)');

select pg_temp.como('b8000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select c ->> 'acceso_creado' from jsonb_array_elements(api.cuentas_lista() -> 'cuentas') c where c ->> 'correo' = 'b8.bodega@example.test'), 'true', 'con usuario de Auth: acceso creado');
reset role;

-- Nadie salvo socio administra cuentas -----------------------------------------------------------------------------------------------
select pg_temp.como('b8000000-0000-0000-0000-000000000003');
set local role authenticated;
select is((api.mi_sesion() ->> 'rol'), 'bodega', 'mi_sesion de bodega');
select throws_ok($$select api.cuentas_lista()$$, '42501', null, 'bodega no lista cuentas');
select throws_ok($$select api.cuenta_alta('b8-x1', 'b8.otro@example.test', 'bodega')$$, '42501', null, 'bodega no crea cuentas');
select throws_ok($$select api.cuenta_cambiar_estado('b8-x2', 'b8.bodega@example.test', false)$$, '42501', null, 'bodega no cambia estados');
reset role;
select pg_temp.como('b8000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select api.cuentas_lista()$$, '42501', null, 'omar activo no lista cuentas');
select throws_ok($$select api.cuenta_alta('b8-x3', 'b8.otro@example.test', 'bodega')$$, '42501', null, 'omar no crea cuentas');
select throws_ok($$select api.cuenta_cambiar_estado('b8-x4', 'b8.bodega@example.test', false)$$, '42501', null, 'omar no cambia estados');
reset role;
select pg_temp.como(null);
set local role anon;
select throws_ok($$select api.cuentas_lista()$$, '42501', null, 'anon no lista cuentas (sin EXECUTE)');
select throws_ok($$select api.cuenta_alta('b8-x5', 'b8.otro@example.test', 'bodega')$$, '42501', null, 'anon no crea cuentas');
reset role;
select is((select count(*)::int from pg_proc p where p.oid in ('api.cuentas_lista()'::regprocedure, 'api.cuenta_alta(text,text,text,text)'::regprocedure, 'api.cuenta_cambiar_estado(text,text,boolean,text)'::regprocedure)
            and (has_function_privilege('anon', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))), 0, 'has_function_privilege: sin EXECUTE para anon ni PUBLIC');
select is((select count(*)::int from pg_proc p where p.oid in ('api.cuentas_lista()'::regprocedure, 'api.cuenta_alta(text,text,text,text)'::regprocedure, 'api.cuenta_cambiar_estado(text,text,boolean,text)'::regprocedure)
            and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 3, 'has_function_privilege: authenticated si (el rol se valida dentro)');

-- Desactivar bloquea el acceso; reactivar lo devuelve; nada se borra -----------------------------------------------------------------
select pg_temp.como('b8000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((api.cuenta_cambiar_estado('b8-d1', 'b8.bodega@example.test', false, 'ya no trabaja aqui') ->> 'estado'), 'desactivada', 'desactivar');
select is((api.cuenta_cambiar_estado('b8-d1', 'b8.bodega@example.test', false, 'ya no trabaja aqui') ->> 'repetido')::boolean, true, 'misma clave: repetido');
select is((api.cuenta_cambiar_estado('b8-d2', 'b8.bodega@example.test', false) ->> 'estado'), 'sin_cambio', 'desactivar otra vez: sin cambio');
reset role;
select is((select activo from seguridad.usuario where id = 'b8000000-0000-0000-0000-000000000003'), false, 'el usuario queda inactivo');
select is((select activo from seguridad.correo_permitido where correo = 'b8.bodega@example.test'), false, 'la lista queda inactiva (la fila no se borra)');
select pg_temp.como('b8000000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$select api.bodega_llegadas()$$, '42501', null, 'bodega desactivada: sin acceso a su vista');
select throws_ok($$select api.bodega_hoy_a_preparar()$$, '42501', null, 'bodega desactivada: sin acceso a su vista (hoy)');
select is((api.mi_sesion() ->> 'activo')::boolean, false, 'mi_sesion dice inactiva (la guarda de la web la manda al login)');
reset role;
select pg_temp.como('b8000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((api.cuenta_cambiar_estado('b8-d3', 'b8.bodega@example.test', true) ->> 'estado'), 'reactivada', 'reactivar');
reset role;
select pg_temp.como('b8000000-0000-0000-0000-000000000003');
set local role authenticated;
select ok(api.bodega_llegadas() ? 'compras', 'reactivada: vuelve a su vista');
reset role;
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and accion = 'UPDATE' and despues ->> 'activo' = 'false' and despues ->> 'motivo' = 'ya no trabaja aqui'), 1, 'auditoria de la baja con motivo');
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and accion = 'UPDATE' and despues ->> 'activo' = 'true'), 1, 'auditoria de la reactivacion');

-- Tope de cuentas creadas desde la web ------------------------------------------------------------------------------------------------
insert into seguridad.correo_permitido (correo, rol, activo) select 'b8.relleno' || g || '@example.test', 'bodega', true from generate_series(1, 19) g;
select pg_temp.como('b8000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$select api.cuenta_alta('b8-t1', 'b8.tope@example.test', 'bodega')$$, '54000', null, 'tope de 20 cuentas activas creadas desde la web');
reset role;

select * from finish();
rollback;
