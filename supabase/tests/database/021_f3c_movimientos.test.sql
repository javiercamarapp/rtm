-- pgTAP F3c: zona Movimientos. Filas ilustrativas inventadas; cifras escritas a mano antes del codigo.
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('f3c.mov@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('77777777-7777-7777-7777-777777777771', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'f3c.mov@example.test');
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777771', true);
create function pg_temp.fila(p_fecha text, p_monto bigint, p_msg text) returns jsonb language sql as
  $$ select jsonb_build_object('fecha', $1, 'monto_cent', $2, 'cuenta', 'Cuenta ilustrativa', 'origen', 'Origen ilustrativo', 'mensaje', $3) $$;
create function pg_temp.filas() returns jsonb language sql as $$ select jsonb_build_array(
  pg_temp.fila((negocio.hoy() - 9)::text, 1000000, 'Cobro ilustrativo uno'),
  pg_temp.fila((negocio.hoy() - 8)::text, -250000, 'Pago ilustrativo a proveedor'),
  pg_temp.fila((negocio.hoy() - 8)::text, -250000, 'Pago ilustrativo a proveedor'),
  pg_temp.fila((negocio.hoy() - 7)::text, 500000, 'Deposito sin nombre')) $$;

-- Importacion: dry-run, reimportar y filas invalidas -------------------------------------------------------------------------------------------
select is((api.mov_importar('m:0', 'pegado', null, null, pg_temp.filas(), true) ->> 'filas_nuevas')::int, 4, 'el dry-run cuenta cuatro filas nuevas');
select is((select count(*)::int from operacion.movimiento_crudo), 0, 'y no escribe nada');
select is((select count(*)::int from seguridad.operacion where clave = 'm:0'), 0, 'ni deja clave de idempotencia');
select is((api.mov_importar('m:1', 'pegado', null, null, pg_temp.filas()) ->> 'filas_nuevas')::int, 4, 'la primera importacion crea cuatro filas (dos identicas legitimas se conservan)');
select is((api.mov_importar('m:1', 'pegado', null, null, pg_temp.filas()) ->> 'filas_nuevas')::int, 4, 'la misma clave devuelve el mismo resultado');
select is((api.mov_importar('m:2', 'pegado', null, null, pg_temp.filas()) ->> 'filas_nuevas')::int, 0, 'reimportar las mismas filas da 0 filas nuevas');
select is((select count(*)::int from operacion.movimiento_crudo), 4, 'el numero de filas no cambia');
select is((api.mov_importar('m:3', 'archivo', 'ilustrativo.csv', repeat('a', 64), jsonb_build_array(pg_temp.fila((negocio.hoy() - 9)::text, 1000000, 'Cobro ilustrativo uno'), pg_temp.fila((negocio.hoy() - 5)::text, 77700, 'Nuevo'))) ->> 'filas_duplicadas')::int, 1, 'un archivo con una fila ya cargada y una nueva: una duplicada');
select is((select count(*)::int from operacion.movimiento_crudo), 5, 'cinco filas');
select is(jsonb_array_length(api.mov_importar('m:4', 'pegado', null, null, jsonb_build_array(
  jsonb_build_object('fecha', 'ayer', 'monto_cent', 100), jsonb_build_object('fecha', '2026-02-30', 'monto_cent', 100), jsonb_build_object('fecha', (negocio.hoy() + 2)::text, 'monto_cent', 100),
  jsonb_build_object('fecha', '2026-01-01', 'monto_cent', 0), pg_temp.fila((negocio.hoy() - 3)::text, 100, 'valida')), true) -> 'invalidas'), 4, 'cuatro filas invalidas con su linea');
select throws_ok($$ select api.mov_importar('m:5', 'otro', null, null, '[]') $$, '22023', 'fuente desconocida', 'fuente desconocida');

-- Una fila sin clasificar no afecta ningun saldo ---------------------------------------------------------------------------------------------------
select is((select count(*)::int from operacion.movimiento_vigente where estado = 'sin_clasificar'), 5, 'las cinco entran sin clasificar');
select operacion.registrar_aportacion('c:ap', 'Angelo', 500000, 'Aportacion ilustrativa de prueba', 'capital');
select operacion.registrar_aportacion('c:ap2', 'Angelo', 123456, 'Otra aportacion ilustrativa', 'capital');
create temp table _antes as select (select count(*) from operacion.evento) as ev, (select count(*) from contabilidad.asiento) as asi, (select count(*) from operacion.pago) as pagos;
create temp table _cs as select operacion.cuenta_socios() as j;

-- Clasificar -----------------------------------------------------------------------------------------------------------------------------------------
select catalogo.asegurar_cliente('F3C Mov Cliente', 'Javier');
create function pg_temp.mid(p_msg text, p_n int default 1) returns bigint language sql as
  $$ select id from (select id, row_number() over (order by id) as k from operacion.movimiento_crudo where mensaje_original = $1) x where k = $2 $$;
select throws_ok(format($$ select api.mov_clasificar('c:0', %s, 'cobro_cliente', '{}') $$, pg_temp.mid('Cobro ilustrativo uno')), '23514', null, 'un cobro necesita cliente o pedido');
select throws_ok(format($$ select api.mov_clasificar('c:0b', %s, 'pago_proveedor', '{"proveedor_id": %s}') $$, pg_temp.mid('Cobro ilustrativo uno'), catalogo.proveedor_id('Isaac')), '23514', null, 'un pago a proveedor no puede ser una entrada');
select throws_ok(format($$ select api.mov_clasificar('c:0c', %s, 'otro', '{}') $$, pg_temp.mid('Cobro ilustrativo uno')), '23502', 'otro exige motivo', 'otro exige motivo');
select is((api.mov_clasificar('c:1', pg_temp.mid('Cobro ilustrativo uno'), 'cobro_cliente', format('{"cliente_id": %s}', (select id from catalogo.cliente where nombre_canonico = 'F3C Mov Cliente'))::jsonb) ->> 'estado'), 'clasificado', 'se clasifica un cobro');
select is((api.mov_clasificar('c:2', pg_temp.mid('Pago ilustrativo a proveedor', 1), 'pago_proveedor', format('{"proveedor_id": %s}', catalogo.proveedor_id('Isaac'))::jsonb) ->> 'version')::int, 1, 'version 1');
select api.mov_clasificar('c:3', pg_temp.mid('Pago ilustrativo a proveedor', 2), 'pago_proveedor', format('{"proveedor_id": %s}', catalogo.proveedor_id('Karen'))::jsonb);
select api.mov_clasificar('c:4', pg_temp.mid('Deposito sin nombre'), 'fondos_en_poder_socio', '{"socio": "Angelo"}');
select is((api.mov_marcar('c:5', pg_temp.mid('Nuevo'), 'descartado', 'prueba de descarte') ->> 'estado'), 'descartado', 'se descarta un movimiento con motivo');
select throws_ok(format($$ select api.mov_clasificar('c:6', %s, 'gasto', '{}') $$, pg_temp.mid('Nuevo')), 'P0443', null, 'un movimiento descartado no se reclasifica');
select is((api.mov_clasificar('c:7', pg_temp.mid('Cobro ilustrativo uno'), 'cobro_cliente', format('{"cliente_id": %s}', (select id from catalogo.cliente where nombre_canonico = 'F3C Mov Cliente'))::jsonb) ->> 'version')::int, 2, 'reclasificar un clasificado crea la version 2');
select is((select count(*)::int from operacion.clasificacion_movimiento where movimiento_crudo_id = pg_temp.mid('Cobro ilustrativo uno')), 2, 'las versiones anteriores se conservan');

-- Agrupar y desglosar -----------------------------------------------------------------------------------------------------------------------------
select is((select (g ->> 'entradas_cent')::bigint from jsonb_array_elements(api.mov_agrupado('cliente')) g where g ->> 'etiqueta' = 'F3C Mov Cliente'), 1000000::bigint, 'por cliente: entradas 10,000.00');
select is((select (g ->> 'salidas_cent')::bigint from jsonb_array_elements(api.mov_agrupado('proveedor')) g where g ->> 'etiqueta' = 'Isaac'), 250000::bigint, 'por proveedor: Isaac 2,500.00 de salidas');
select is((select (g ->> 'neto_cent')::bigint from jsonb_array_elements(api.mov_agrupado('socio')) g where g ->> 'etiqueta' = 'Angelo'), 500000::bigint, 'por socio: lo recibido por Angelo');
select is(jsonb_array_length(api.mov_desglose('cliente', (select id from catalogo.cliente where nombre_canonico = 'F3C Mov Cliente'))), 1, 'el desglose del cliente trae su movimiento');
select is((select coalesce(sum((g ->> 'n')::int), 0) from jsonb_array_elements(api.mov_agrupado('cliente')) g), 1::bigint, 'los sin clasificar y descartados no entran a ninguna agrupacion');
select throws_ok($$ select api.mov_agrupado('dueno') $$, '22023', 'agrupación desconocida', 'no se agrupa por dueno');

-- Conciliar: la contraparte debe tener la misma suma ------------------------------------------------------------------------------------------------
create function pg_temp.ap(p_monto bigint) returns bigint language sql as $$ select id from operacion.aportacion_socio where monto_cent = $1 and concepto like '%ilustrativa%' $$;
select throws_ok(format($$ select api.mov_conciliar('k:0', %s, 'aportacion', %s) $$, pg_temp.mid('Deposito sin nombre'), pg_temp.ap(123456)), 'P0433', null, 'una contraparte con otra suma no concilia');
select throws_ok(format($$ select api.mov_conciliar('k:0b', %s, 'aportacion', %s) $$, pg_temp.mid('Cobro ilustrativo uno'), pg_temp.ap(500000)), 'P0433', null, 'ni con otra suma ni con otro sentido');
select is(jsonb_array_length(api.mov_candidatas('aportacion', 500000)), 1, 'la lista de candidatas ofrece la aportacion de la misma suma');
select is((api.mov_conciliar('k:1', pg_temp.mid('Deposito sin nombre'), 'aportacion', pg_temp.ap(500000)) ->> 'estado'), 'conciliado', 'concilia con la misma suma');
select is(jsonb_array_length(api.mov_candidatas('aportacion', 500000)), 0, 'una contraparte concilia una sola vez');
select throws_ok(format($$ select api.mov_clasificar('k:2', %s, 'otro', '{}') $$, pg_temp.mid('Deposito sin nombre')), '23502', null, 'reclasificar un conciliado exige motivo');
select throws_ok(format($$ select api.mov_marcar('k:3', %s, 'descartado', 'x') $$, pg_temp.mid('Deposito sin nombre')), 'P0443', null, 'un conciliado no se descarta directamente');

-- Sin efecto en los saldos ------------------------------------------------------------------------------------------------------------------------
select is((select count(*) from operacion.pago), (select pagos from _antes), 'clasificar y conciliar no crean pagos');
select is((operacion.cuenta_socios() -> 'javier_debe_a_angelo_cent'), (select j -> 'javier_debe_a_angelo_cent' from _cs) , 'ni mueven la posicion entre socios');
select contabilidad.asentar_pendientes();
select is((select count(*)::int from contabilidad.comprobaciones() where not ok and bloqueante), 0, 'sin comprobaciones bloqueantes en rojo');

-- Resumen y utilidad ------------------------------------------------------------------------------------------------------------------------------
select is((select (e ->> 'n')::int from jsonb_array_elements(api.mov_resumen() -> 'estados') e where e ->> 'estado' = 'conciliado'), 1, 'un conciliado');
select is((api.mov_resumen() ->> 'total')::int, 5, 'cinco movimientos en total');
select is(jsonb_typeof(api.mov_utilidad() -> 'pedidos'), 'array', 'la utilidad por pedido es una lista');
select is(jsonb_array_length(api.mov_utilidad() -> 'socios'), 2, 'la utilidad acumulada trae a los dos socios');
select is(((api.mov_utilidad() -> 'socios') -> 0 ->> 'socio'), 'Angelo', 'Angelo primero');
select is((select sum((s ->> 'mitad_cent')::bigint)::bigint from jsonb_array_elements(api.mov_utilidad() -> 'socios') s), (api.mov_utilidad() ->> 'utilidad_total_cent')::bigint, 'las dos mitades suman la utilidad total');
select is(has_function_privilege('authenticated', 'operacion.importar_movimientos(text, text, text, text, jsonb, boolean)', 'execute'), false, 'la funcion interna no se ejecuta desde la web');
select is(has_table_privilege('authenticated', 'operacion.movimiento_crudo', 'select'), false, 'las tablas no se leen desde la web');
select throws_ok($$ update operacion.movimiento_crudo set monto_cent = 1 $$, '42501', null, 'los movimientos crudos son de solo insercion');

select * from finish();
rollback;
