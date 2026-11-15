-- pgTAP: funciones de la carga mensual de costos (dato faltante y uso de Claude). Cifras ilustrativas.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('cos2.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('88888888-8888-8888-8888-888888888882', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cos2.javier@example.test');
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888882', true);

select is((costos.registrar_dato_faltante('supabase', '2031-04', 'sin horas de computo') ->> 'nuevo')::boolean, true, 'abre el faltante');
select is((costos.registrar_dato_faltante('supabase', '2031-04', 'sin horas de computo del mes') ->> 'nuevo')::boolean, false, 'segunda vez: no abre otro, actualiza el motivo');
select is((select count(*)::int from costos.dato_faltante f join costos.servicio s on s.id = f.servicio_id where s.slug = 'supabase' and f.mes = '2031-04' and f.resuelto_at is null), 1, 'un solo faltante abierto por servicio y mes');
select is((api.costos_resumen('2031-04') ->> 'al_menos')::boolean, true, 'el resumen dice "al menos" con un faltante abierto');
select throws_ok($$ select costos.registrar_dato_faltante('supabase', '2031-04', ' ') $$, '23502', null, 'exige motivo');
select throws_ok($$ select costos.registrar_dato_faltante('nada', '2031-04', 'x') $$, '22023', null, 'servicio desconocido');
select is(costos.resolver_dato_faltante('supabase', '2031-04'), 1, 'resuelve el abierto');
select is((api.costos_resumen('2031-04') ->> 'al_menos')::boolean, false, 'sin faltantes abiertos ya no dice "al menos"');
select is(costos.resolver_dato_faltante('supabase', '2031-04'), 0, 'resolver de nuevo no hace nada');

select is((costos.importar_claude_uso('2031-04', 'entrada_salida_escritura_cache', 10, 60, 166666, 170000, 3, repeat('a', 64), '1.0.0') ->> 'repetido')::boolean, false, 'importa el uso de Claude');
select is((costos.importar_claude_uso('2031-04', 'entrada_salida_escritura_cache', 10, 60, 166666, 170000, 3, repeat('a', 64), '1.0.0') ->> 'repetido')::boolean, true, 'mismo JSON: idempotente');
select throws_ok($$ select costos.importar_claude_uso('2031-04', 'otra', 1, 1, 1, 1, 1, repeat('b', 64), '1') $$, '23514', null, 'metrica desconocida se rechaza');

select is(has_function_privilege('authenticated', 'costos.registrar_dato_faltante(text,text,text)', 'EXECUTE'), false, 'la web no ejecuta registrar_dato_faltante');
select is(has_function_privilege('authenticated', 'costos.importar_claude_uso(text,text,bigint,bigint,int,int,int,text,text)', 'EXECUTE'), false, 'la web no ejecuta importar_claude_uso');
select * from finish();
rollback;
