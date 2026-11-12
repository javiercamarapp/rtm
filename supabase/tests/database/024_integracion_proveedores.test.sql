-- pgTAP integracion 2: inventario actual de proveedores. Datos sinteticos.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('prov.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('99999999-9999-9999-9999-999999999991', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prov.javier@example.test');
select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999991', true);

create function pg_temp.estado(p_disp boolean default true) returns jsonb language sql as $$ select jsonb_build_object(
  'version', 1, 'inicializado', true, 'tarjetasPromo', 3,
  'modelos', jsonb_build_object('900000000000000001', jsonb_build_object('id', '900000000000000001', 'handle', 'modelo-sintetico', 'titulo', 'Modelo Sintetico 8000', 'tituloNorm', 'modelo sintetico 8k', 'aliasTitulos', '[]'::jsonb,
     'marca', 'Marca S', 'puffs', 8000, 'estado', 'activo', 'primeraVez', '2026-11-10T12:00:00Z', 'ultimaVez', '2026-11-10T13:00:00Z', 'ausencias', 0, 'primeraAusencia', null, 'sinSabores', false,
     'nuevoSinCosto', true, 'mapeo', 'pendiente', 'canonicoId', null, 'gruposCandidatos', '[]'::jsonb)),
  'variantes', jsonb_build_object('900000000000000101', jsonb_build_object('id', '900000000000000101', 'productoId', '900000000000000001', 'saborOriginal', 'Sandia', 'saborNorm', 'sandia', 'disponible', p_disp,
     'estado', 'activa', 'ausencias', 0, 'primeraAusencia', null, 'mapeo', 'pendiente', 'saborCanonicoId', null, 'cambios', '["2026-11-10T12:30:00Z"]'::jsonb, 'inestableHasta', null,
     'primeraVez', '2026-11-10T12:00:00Z', 'ultimaVez', '2026-11-10T13:00:00Z')),
  'candidatos', '{}'::jsonb, 'retenida', null,
  'promociones', jsonb_build_object('p1', jsonb_build_object('clave', 'p1', 'tipo', 'porcentaje', 'pct', 15, 'etiqueta', '15 % en 1 modelo', 'alcance', '["900000000000000001"]'::jsonb, 'inicio', null, 'fin', '2026-11-17T23:59:00Z',
     'primeraVista', '2026-11-10T12:00:00Z', 'ultimaVista', '2026-11-10T13:00:00Z', 'lecturasAusente', 0, 'estado', 'activa', 'avisoPorTerminar', false, 'coleccion', null)),
  'cola', jsonb_build_array(jsonb_build_object('tipo', 'modelo', 'textoOriginal', 'Modelo Sintetico 8000', 'textoNorm', 'modelo sintetico 8k', 'sugerenciaId', null, 'similitud', null, 'creada', '2026-11-10T12:00:00Z')),
  'historialVariedad', '{}'::jsonb, 'variedad', '{}'::jsonb,
  'salud', jsonb_build_object('ultimaLecturaOk', '2026-11-10T13:00:00Z', 'ultimoIntento', '2026-11-10T13:00:00Z', 'fallosSeguidos', 0, 'bloqueada', false, 'incidente', null),
  'lecturasProcesadas', '["fuente|2026-11-10|13"]'::jsonb) $$;
create function pg_temp.evs() returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('clave', 'modelo_nuevo|900000000000000001|L1', 'tipo', 'modelo_nuevo', 'productoId', '900000000000000001',
  'varianteId', null, 'lectura', 'L1', 'en', '2026-11-10T12:00:00Z', 'antes', null, 'despues', 'Modelo Sintetico 8000', 'datos', '{"modelo": "Modelo Sintetico 8000"}'::jsonb)) $$;

select is((proveedores.guardar_estado(pg_temp.estado(), pg_temp.evs(), 'g:1') ->> 'eventos_nuevos')::int, 1, 'se guarda el estado y un evento');
select is((proveedores.guardar_estado(pg_temp.estado(), pg_temp.evs(), 'g:1') ->> 'eventos_nuevos')::int, 1, 'la misma clave devuelve el mismo resultado');
select is((proveedores.guardar_estado(pg_temp.estado(false), pg_temp.evs(), 'g:2') ->> 'eventos_nuevos')::int, 0, 'el mismo evento no se duplica');
select is((select count(*)::int from proveedores.evento where clave = 'modelo_nuevo|900000000000000001|L1'), 1, 'un solo evento de esa clave');
select is((proveedores.cargar_estado() -> 'variantes' -> '900000000000000101' ->> 'disponible')::boolean, false, 'el estado vigente se reemplaza');
select is(proveedores.cargar_estado() #>> '{modelos,900000000000000001,tituloNorm}', 'modelo sintetico 8k', 'ida y vuelta de un modelo');
select is(proveedores.cargar_estado() #>> '{variantes,900000000000000101,cambios,0}', '2026-11-10T12:30:00+00:00', 'los cambios viajan como instantes');
select is(proveedores.cargar_estado() #>> '{promociones,p1,pct}', '15', 'promocion con porcentaje entero');
select is(jsonb_array_length(proveedores.cargar_estado() -> 'cola'), 1, 'la cola de confirmacion viaja');
select throws_ok($$ select proveedores.guardar_estado(jsonb_set(pg_temp.estado(), '{modelos,900000000000000001,precio}', '1'), '[]', 'g:3') $$, 'P0461', null, 'una clave de importe se rechaza');
select throws_ok($$ select proveedores.guardar_estado(pg_temp.estado(), '[{"clave":"x","tipo":"t","lectura":"L","en":"2026-11-10T12:00:00Z","datos":{"monto_cent":5}}]', 'g:4') $$, 'P0461', null, 'tambien en los eventos');
select is((select count(*)::int from information_schema.columns where table_schema = 'proveedores' and column_name <> 'nuevo_sin_costo' and (column_name ~* '(precio|price|compare|importe|monto|costo)' or column_name ~ '_cent$')), 0, 'ningun nombre de columna es un importe (nuevo_sin_costo es una bandera)');

-- Presupuesto: 40 al dia como maximo.
select is((select count(*)::int from generate_series(1, 45) g where proveedores.presupuesto_tomar('2026-11-10', 'catalogo')), 40, 'solo 40 peticiones caben en un dia');
select is((proveedores.cargar_presupuesto('2026-11-10') ->> 'usadas')::int, 40, 'el contador se queda en 40');
select is(proveedores.presupuesto_tomar('2026-11-11', 'robots'), true, 'otro dia empieza en cero');
select throws_ok($$ select proveedores.presupuesto_tomar('2026-11-11', 'otra') $$, '22023', null, 'tipo desconocido');

-- Foto diaria idempotente.
select is(proveedores.guardar_foto_diaria('2026-11-10', '[{"varianteId":"v1","disponible":true},{"varianteId":"v2","disponible":false}]'), 2, 'foto diaria de dos filas');
select is(proveedores.guardar_foto_diaria('2026-11-10', '[{"varianteId":"v1","disponible":true},{"varianteId":"v2","disponible":false}]'), 2, 'repetirla reemplaza, no duplica');
select is((select count(*)::int from proveedores.foto_diaria where dia = '2026-11-10'), 2, 'dos filas');

-- Avisos.
select ok(proveedores.emitir_aviso('P-01', 'P-01|900000000000000001', 'modelo', '900000000000000001', '{"modelo":"Modelo Sintetico 8000","disponibles":3}', 'Modelo nuevo') is not null, 'P-01 emite un aviso');
select is((select count(*)::int from operacion.aviso where clave_dedupe = 'prov:P-01|900000000000000001'), 1, 'un aviso');
select proveedores.emitir_aviso('P-01', 'P-01|900000000000000001', 'modelo', '900000000000000001', '{"modelo":"Modelo Sintetico 8000","disponibles":3}', 'Modelo nuevo');
select is((select conteo from operacion.aviso where clave_dedupe = 'prov:P-01|900000000000000001'), 2, 'repetir solo sube el conteo');
select is(proveedores.resolver_aviso('P-01|900000000000000001'), 1, 'resolver cierra el aviso');
select throws_ok($$ select proveedores.emitir_aviso('P-01', 'x', 'modelo', '1', '{"precio": 1}', 't') $$, 'P0461', null, 'un aviso no lleva importes');
select throws_ok($$ select proveedores.emitir_aviso('P-99', 'x', 'modelo', '1', '{}', 't') $$, '22023', null, 'codigo desconocido');

-- Pantalla y permisos.
select is((api.prov_inventario() -> 'modelos' -> 0 ->> 'marca'), 'Marca S', 'la pantalla lee el inventario');
select is((api.prov_inventario() -> 'frescura' ->> 'tope_dia'), '40', 'frescura con el tope');
select is(has_function_privilege('authenticated', 'proveedores.guardar_estado(jsonb,jsonb,text)', 'EXECUTE'), false, 'la web no ejecuta el guardado');
select is(has_function_privilege('servidor', 'proveedores.guardar_estado(jsonb,jsonb,text)', 'EXECUTE'), true, 'el rol servidor si');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'proveedores' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)), 0, 'RLS forzada');
select is((select activo from seguridad.interruptor where clave = 'promociones_lectura'), false, 'promociones_lectura nace apagado');
select * from finish();
rollback;
