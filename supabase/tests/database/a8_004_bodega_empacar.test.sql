-- pgTAP a8_004: bodega marca empacado un pedido confirmado (sin dinero), idempotente, con auditoria; omar y anon no; un borrador o un enviado no.
begin;
select no_plan();
update catalogo.config set vigente_desde = '2026-10-01' where vigente_desde > '2026-10-01';
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('b84.socio@example.test', 'socio', 'Angelo', true), ('b84.bodega@example.test', 'bodega', null, true), ('b84.omar@example.test', 'omar', null, true);
insert into auth.users (id, instance_id, aud, role, email) values
  ('b8400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b84.socio@example.test'),
  ('b8400000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b84.bodega@example.test'),
  ('b8400000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b84.omar@example.test');
create function pg_temp.como(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce($1::text, ''), true) $$;
select pg_temp.como('b8400000-0000-0000-0000-000000000001');
select catalogo.asegurar_cliente('B84 Bodega', 'Javier', 'credito_interno');
select catalogo.asegurar_persona_bodega('B84 Bodega', 'B84 Bodega');
select catalogo.asegurar_cliente('B84 Cliente', 'Angelo');
select catalogo.asegurar_modelo('B84 Marca', 'B84 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_sku('B84 Modelo 50K', 'Fresa');
select catalogo.fijar_costo('b84c', 'Isaac', 'B84 Modelo 50K', 10000, '2026-11-01', 'prueba');
select catalogo.fijar_precio('b84p', 'B84 Cliente', 'B84 Modelo 50K', 15000, '2026-11-01', 'chat');
select operacion.registrar_movimiento('b84m', 'B84 Modelo 50K', 'Fresa', 'bodega_omar', 'entrada_compra', 50, 500000, '2026-11-01');
select operacion.crear_pedido('b84a', (select id from catalogo.cliente where nombre_canonico = 'B84 Cliente'), '[{"modelo":"B84 Modelo 50K","sabor":"Fresa","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-13');
select operacion.crear_pedido('b84b', (select id from catalogo.cliente where nombre_canonico = 'B84 Cliente'), '[{"modelo":"B84 Modelo 50K","sabor":"Fresa","piezas":21}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2026-11-13');
select operacion.confirmar_pedido('b84ac', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b84a'));
create temp table _f as select folio from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b84a');
create temp table _fb as select folio from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'b84b');
grant select on _f, _fb to authenticated;

select pg_temp.como('b8400000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select (x ->> 'empacado')::boolean from jsonb_array_elements(api.bodega_hoy_a_preparar() #> '{clientes,0,pedidos}') x limit 1), false, 'antes: por empacar');
select is(api.bodega_marcar_empacado('b84-e1', (select folio from _f)) ->> 'empacado', 'true', 'bodega marca empacado');
select is((api.bodega_marcar_empacado('b84-e1', (select folio from _f)) ->> 'repetido')::boolean, true, 'misma clave: repetido');
select is(api.bodega_marcar_empacado('b84-e2', (select folio from _f)) ->> 'empacado', 'true', 'otra clave sobre un pedido ya empacado: sin error ni cambio');
select is((select (x ->> 'empacado')::boolean from jsonb_array_elements(api.bodega_hoy_a_preparar() #> '{clientes,0,pedidos}') x limit 1), true, 'despues: empacado');
select throws_ok($$select api.bodega_marcar_empacado('b84-e3', (select folio from _fb))$$, 'P0428', null, 'un borrador no se empaca');
select throws_ok($$select api.bodega_marcar_empacado('b84-e4', 'P-9999999')$$, '22023', null, 'pedido desconocido');
select throws_ok($$select api.bodega_marcar_empacado('', (select folio from _f))$$, '22023', null, 'sin clave');
select throws_ok($$select operacion.marcar_empacado('b84-x', 1)$$, '42501', null, 'bodega no ejecuta la funcion de operacion');
select throws_ok($$select operacion.enviar_pedido('b84-x2', 1, null, '{}'::jsonb, '2026-11-13')$$, '42501', null, 'bodega no envia pedidos');
reset role;
select is((select count(*)::int from operacion.movimiento_inventario where tipo <> 'entrada_compra'), 0, 'empacar no mueve inventario');
select is((select count(*)::int from seguridad.auditoria where tabla = 'operacion.pedido' and accion = 'EMPACADO' and actor = 'b8400000-0000-0000-0000-000000000002'), 2, 'auditoria del empaque con el actor (una por clave nueva)');

select pg_temp.como('b8400000-0000-0000-0000-000000000003');
set local role authenticated;
select throws_ok($$select api.bodega_marcar_empacado('b84-o1', (select folio from _f))$$, '42501', null, 'omar no empaca desde la vista de bodega');
reset role;
select pg_temp.como(null);
set local role anon;
select throws_ok($$select api.bodega_marcar_empacado('b84-n1', 'P-1')$$, '42501', null, 'anon no');
reset role;
select is((select count(*)::int from pg_proc p where p.oid = 'api.bodega_marcar_empacado(text,text)'::regprocedure and (has_function_privilege('anon', p.oid, 'EXECUTE') or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))), 0, 'sin EXECUTE para anon ni PUBLIC');
select * from finish();
rollback;
