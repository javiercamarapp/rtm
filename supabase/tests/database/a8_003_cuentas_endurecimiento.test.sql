-- pgTAP a8_003: endurecimiento de cuentas. Tope tambien al reactivar, validacion de correo alineada con GoTrue, unicidad por forma canonica (punto final, Unicode),
-- sin correo en claro en seguridad.operacion ni en la auditoria (motivo). Cada prueba falla sin el arreglo de 20261114000300.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('b83.socio@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('b8300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b83.socio@example.test');
select set_config('request.jwt.claim.sub', 'b8300000-0000-0000-0000-000000000001', true);
set local role authenticated;

-- Validacion ----------------------------------------------------------------------------------------------------------------------
select throws_ok(format($$select api.cuenta_alta('b83-v%s', %L, 'bodega')$$, i, c), '22023', null, 'correo invalido: ' || d)
  from (values (1, 'a b@example.test', 'espacio interno'), (2, 'a,b@example.test', 'coma'), (3, '<a>@example.test', 'angulares'), (4, 'a@@example.test', 'dos arrobas'),
               (5, E'ñandú@example.test', 'no ASCII'), (6, 'a@' || 'example', 'dominio sin punto'), (7, '.a@example.test', 'punto inicial en la parte local'),
               (8, 'a..b@example.test', 'puntos dobles'), (9, 'a@' || '-example.test', 'etiqueta con guion inicial'), (10, repeat('x', 65) || '@example.test', 'parte local de 65'),
               (11, 'a@example.t', 'TLD de una letra')) v(i, c, d);
select is(api.cuenta_alta('b83-ok', 'ok+tag.1@example.test', 'bodega') ->> 'estado', 'creada', 'un correo valido con +tag se acepta');

-- Forma canonica --------------------------------------------------------------------------------------------------------------------
select is(api.cuenta_alta('b83-c1', 'B83.Canon@Example.test', 'bodega') ->> 'estado', 'creada', 'alta canonica');
select is(api.cuenta_alta('b83-c2', 'b83.canon@example.test.', 'bodega') ->> 'estado', 'sin_cambio', 'el mismo correo con punto final es duplicado');
select is(api.cuenta_alta('b83-c3', E'ｂ' || '83.canon@example.test', 'bodega') ->> 'estado', 'sin_cambio', 'una variante Unicode de ancho completo (NFKC) es duplicado');
select is(api.cuenta_alta('b83-c4', '  B83.CANON@EXAMPLE.TEST  ', 'bodega') ->> 'estado', 'sin_cambio', 'mayusculas y espacios del borde: duplicado');
reset role;
select is((select count(*)::int from seguridad.correo_permitido where correo like 'b83.canon%'), 1, 'una sola fila canonica');
select is((select count(*)::int from seguridad.correo_permitido where correo ~ '\.$'), 0, 'ninguna fila con punto final');
select is(seguridad.correo_canonico('  B83.X@Example.test. '), 'b83.x@example.test', 'correo_canonico: trim, minusculas y sin punto final');

-- Sin correo en claro en seguridad.operacion y en la auditoria ----------------------------------------------------------------------------
select is((select count(*)::int from seguridad.operacion where resultado::text ilike '%b83.canon%' or resultado::text ilike '%@%'), 0, 'seguridad.operacion no guarda el correo en claro');
select set_config('request.jwt.claim.sub', 'b8300000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is(api.cuenta_cambiar_estado('b83-m1', 'b83.canon@example.test', false, 'avisar a persona.real@example.test por favor') ->> 'estado', 'desactivada', 'baja con un correo escrito en el motivo');
reset role;
select is((select count(*)::int from seguridad.operacion where resultado::text ilike '%@%'), 0, 'tampoco tras el cambio de estado');
select is((select count(*)::int from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and coalesce(despues::text, '') ilike '%@%'), 0, 'la auditoria filtra lo que parece un correo');
select is((select despues ->> 'motivo' from seguridad.auditoria where tabla = 'seguridad.correo_permitido' and accion = 'UPDATE' order by id desc limit 1), 'avisar a [correo omitido] por favor', 'el motivo conserva el resto del texto');
select is(seguridad.sin_correos('hola a@example.test y x@example.test'), 'hola [correo omitido] y [correo omitido]', 'sin_correos');

-- Tope al reactivar -----------------------------------------------------------------------------------------------------------------
insert into seguridad.correo_permitido (correo, rol, activo) select 'b83.fill' || g || '@example.test', 'bodega', true from generate_series(1, 20) g;
select set_config('request.jwt.claim.sub', 'b8300000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$select api.cuenta_cambiar_estado('b83-r1', 'b83.canon@example.test', true)$$, '54000', null, 'reactivar con 20 cuentas activas: tope (no se evade desactivando y reactivando)');
reset role;
update seguridad.correo_permitido set activo = false where correo in ('b83.fill1@example.test', 'b83.fill2@example.test');
set local role authenticated;
select is(api.cuenta_cambiar_estado('b83-r2', 'b83.canon@example.test', true) ->> 'estado', 'reactivada', 'con cupo, reactivar funciona');
reset role;

-- Privilegios -----------------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'seguridad' and p.proname in ('correo_canonico', 'correo_valido', 'huella_correo', 'sin_correos')
            and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0, 'las funciones auxiliares no son ejecutables por anon ni authenticated');
select * from finish();
rollback;
