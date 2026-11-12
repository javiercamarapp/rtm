-- pgTAP: api.crear_cliente, editar_cliente, fijar_precio, fijar_costo y costo_historial (solo socios, idempotentes, con vigencia e historial).
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values
  ('t20.angelo@example.test', 'socio', 'Angelo', true), ('t20.javier@example.test', 'socio', 'Javier', true), ('t20.omar@example.test', 'omar', null, true), ('t20.off@example.test', 'omar', null, false);
insert into auth.users (id, instance_id, aud, role, email) values
  ('d2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't20.angelo@example.test'),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't20.javier@example.test'),
  ('d2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't20.omar@example.test'),
  ('d2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 't20.off@example.test');

select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000001', true);
select catalogo.asegurar_modelo('T20 Marca', 'T20 Modelo 50K', 50000, 'ambas');
select catalogo.asegurar_cliente('T20 Cliente Previo', 'Javier');

-- ---- crear_cliente ---------------------------------------------------------------------------------------------------------------------------
create temp table _c as select api.crear_cliente('web:t20-c1', 'T20 Cliente Nuevo', 'mayoreo', 'nota inicial') as r;
select is((select (r->>'creado')::boolean from _c), true, 'crear_cliente: caso feliz crea');
select is((select nota from catalogo.cliente where id = (select (r->>'cliente_id')::bigint from _c)), 'nota inicial', 'guarda la nota');
select is((select s.nombre from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.id = (select (r->>'cliente_id')::bigint from _c)), 'Angelo', 'el dato interno de dueno es el socio que lo crea');
select is(api.crear_cliente('web:t20-c1', 'T20 Cliente Nuevo', 'mayoreo', 'nota inicial'), (select r from _c), 'idempotente: misma clave devuelve lo mismo');
select is((select count(*)::int from catalogo.cliente where nombre_norm = 't20 cliente nuevo'), 1, 'y no duplica');
select throws_ok($$select api.crear_cliente('web:t20-c1', 'Otro', 'mayoreo', null)$$, 'P0409', null, 'misma clave con otro payload = conflicto');
select is((api.crear_cliente('web:t20-c2', 't20  CLIENTE nuevo', 'mayoreo', null)->>'creado')::boolean, false, 'nombre normalizado repetido: creado=false, no duplica');
select throws_ok($$select api.crear_cliente('web:t20-c3', 'T20 X', 'vip', null)$$, '22023', null, 'tipo invalido');
select throws_ok($$select api.crear_cliente('web:t20-c4', '   ', 'mayoreo', null)$$, '22023', null, 'nombre vacio');
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000002', true);
select api.crear_cliente('web:t20-c5', 'T20 Cliente De Javier', 'ocasional', null);
select is((select s.nombre from catalogo.cliente c join catalogo.socio s on s.id = c.duenio_id where c.nombre_norm = 't20 cliente de javier'), 'Javier', 'si lo crea Javier, el dato interno es Javier');

-- ---- editar_cliente --------------------------------------------------------------------------------------------------------------------------
select is((api.editar_cliente('web:t20-e1', (select (r->>'cliente_id')::bigint from _c), 'T20 Cliente Renombrado', 'credito_interno', 'otra nota', true)->>'cliente_id')::bigint, (select (r->>'cliente_id')::bigint from _c), 'editar_cliente: caso feliz');
select is((select nombre_canonico || '|' || tipo || '|' || nota from catalogo.cliente where id = (select (r->>'cliente_id')::bigint from _c)), 'T20 Cliente Renombrado|credito_interno|otra nota', 'cambia nombre, tipo y nota');
select lives_ok($$select api.editar_cliente('web:t20-e1', (select (r->>'cliente_id')::bigint from _c), 'T20 Cliente Renombrado', 'credito_interno', 'otra nota', true)$$, 'editar es idempotente');
select throws_ok($$select api.editar_cliente('web:t20-e2', (select (r->>'cliente_id')::bigint from _c), 'T20 Cliente Previo', null, null, null)$$, '23505', null, 'nombre que choca con otro cliente: 23505');
select throws_ok($$select api.editar_cliente('web:t20-e3', 999999999, 'x', null, null, null)$$, '22023', null, 'cliente inexistente: 22023');
select throws_ok($$select api.editar_cliente('web:t20-e4', (select (r->>'cliente_id')::bigint from _c), null, 'vip', null, null)$$, '22023', null, 'tipo invalido');
select api.fijar_precio('web:t20-pc', (select (r->>'cliente_id')::bigint from _c), (select id from catalogo.modelo where nombre_canonico = 'T20 Modelo 50K'), 20000, '2026-01-01', 'chat', null);
select api.editar_cliente('web:t20-e5', (select (r->>'cliente_id')::bigint from _c), null, null, null, false);
select is((select activo from catalogo.cliente where id = (select (r->>'cliente_id')::bigint from _c)), false, 'desactivar');
select is((select nombre_canonico from catalogo.cliente where id = (select (r->>'cliente_id')::bigint from _c)), 'T20 Cliente Renombrado', 'null conserva el nombre');
select is((select count(*)::int from catalogo.tabulador_precio where cliente_id = (select (r->>'cliente_id')::bigint from _c)), 1, 'desactivar no borra precios');

-- ---- fijar_precio ----------------------------------------------------------------------------------------------------------------------------
create temp table _ids as select (r->>'cliente_id')::bigint as cli, (select id from catalogo.modelo where nombre_canonico = 'T20 Modelo 50K') as mod from _c;
select is((api.fijar_precio('web:t20-p1', (select cli from _ids), (select mod from _ids), 21000, '2026-02-01', 'chat', 'sube lista')->>'sin_cambio')::boolean, false, 'fijar_precio: nuevo precio');
select is((select vigente_hasta from catalogo.tabulador_precio where cliente_id = (select cli from _ids) and precio_cent = 20000), '2026-02-01'::date, 'cierra la vigencia anterior sin borrarla');
select is((select nota from catalogo.tabulador_precio where cliente_id = (select cli from _ids) and precio_cent = 21000), 'sube lista', 'guarda el motivo');
select is(api.fijar_precio('web:t20-p1', (select cli from _ids), (select mod from _ids), 21000, '2026-02-01', 'chat', 'sube lista'), api.fijar_precio('web:t20-p1', (select cli from _ids), (select mod from _ids), 21000, '2026-02-01', 'chat', 'sube lista'), 'idempotente');
select is((api.fijar_precio('web:t20-p2', (select cli from _ids), (select mod from _ids), 21000, '2026-03-01', 'chat', null)->>'sin_cambio')::boolean, true, 'mismo precio: sin_cambio');
select throws_ok($$select api.fijar_precio('web:t20-p3', (select cli from _ids), (select mod from _ids), 22000, '2026-02-01', 'chat', null)$$, 'P0422', null, 'vigencia retroactiva');
select throws_ok($$select api.fijar_precio('web:t20-p4', (select cli from _ids), (select mod from _ids), 0, '2026-04-01', 'chat', null)$$, '23514', null, 'precio 0');
select throws_ok($$select api.fijar_precio('web:t20-p5', (select cli from _ids), (select mod from _ids), -5, '2026-04-01', 'chat', null)$$, '23514', null, 'precio negativo');
select throws_ok($$select api.fijar_precio('web:t20-p6', (select cli from _ids), (select mod from _ids), 10000001, '2026-04-01', 'chat', null)$$, '23514', null, 'sobre el tope de 100,000.00');
select throws_ok($$select api.fijar_precio('web:t20-p7', (select cli from _ids), (select mod from _ids), 22000, '2026-04-01', 'otro', null)$$, '22023', null, 'origen invalido');
select throws_ok($$select api.fijar_precio('web:t20-p8', 999999999, (select mod from _ids), 22000, '2026-04-01', 'chat', null)$$, '22023', null, 'cliente inexistente');
select throws_ok($$select api.fijar_precio('web:t20-p9', (select cli from _ids), 999999999, 22000, '2026-04-01', 'chat', null)$$, '22023', null, 'modelo inexistente');

-- ---- fijar_costo y costo_historial -----------------------------------------------------------------------------------------------------------
select is((api.fijar_costo('web:t20-k1', 'Isaac', (select mod from _ids), 9500, '2026-01-01', 'lista de Isaac', null, false, true)->>'sin_cambio')::boolean, false, 'fijar_costo: primer costo');
select is((api.fijar_costo('web:t20-k2', 'Isaac', (select mod from _ids), 9800, '2026-02-01', 'aviso', 'sube proveedor', false, false)->>'sin_cambio')::boolean, false, 'segundo costo (no de lista, con motivo)');
select is((select vigente_hasta from catalogo.costo_proveedor where costo_cent = 9500 and modelo_id = (select mod from _ids)), '2026-02-01'::date, 'cierra la vigencia anterior');
select is(api.fijar_costo('web:t20-k2', 'Isaac', (select mod from _ids), 9800, '2026-02-01', 'aviso', 'sube proveedor', false, false), api.fijar_costo('web:t20-k2', 'Isaac', (select mod from _ids), 9800, '2026-02-01', 'aviso', 'sube proveedor', false, false), 'idempotente');
select throws_ok($$select api.fijar_costo('web:t20-k3', 'Isaac', (select mod from _ids), 9900, '2026-03-01', 'x', null, false, false)$$, '23514', null, 'es_lista=false sin motivo: 23514');
select throws_ok($$select api.fijar_costo('web:t20-k4', 'Isaac', (select mod from _ids), 9900, '2026-01-15', 'x', null, false, true)$$, 'P0422', null, 'vigencia retroactiva');
select throws_ok($$select api.fijar_costo('web:t20-k5', 'Isaac', (select mod from _ids), 0, '2026-03-01', 'x', null, false, true)$$, '23514', null, 'costo 0');
select throws_ok($$select api.fijar_costo('web:t20-k6', 'Pedro', (select mod from _ids), 100, '2026-03-01', 'x', null, false, true)$$, '22023', null, 'proveedor invalido');
select throws_ok($$select api.fijar_costo('web:t20-k7', 'Karen', 999999999, 100, '2026-03-01', 'x', null, false, true)$$, '22023', null, 'modelo inexistente');
select api.fijar_costo('web:t20-k8', 'Karen', (select mod from _ids), 9000, '2026-01-01', 'lista Karen', null, true, true);
select is(jsonb_array_length(api.costo_historial((select mod from _ids))), 3, 'costo_historial: todas las filas de ambos proveedores');
select is(api.costo_historial((select mod from _ids))->0->>'costo_cent', '9800', 'la mas reciente primero');
select is((api.costo_historial((select mod from _ids))->0->>'vigente')::boolean, true, 'marca la vigente');
select is(api.costo_historial((select mod from _ids))->0->>'hasta', null, 'la vigente no tiene hasta');
select catalogo.asegurar_modelo('T20 Marca', 'T20 Sin Costos 10K', 10000, 'ambas');
select is(api.costo_historial((select id from catalogo.modelo where nombre_canonico = 'T20 Sin Costos 10K')), '[]'::jsonb, 'un modelo sin costos devuelve arreglo vacio');
select throws_ok($$select api.costo_historial(999999999)$$, '22023', null, 'modelo inexistente');

-- ---- permisos --------------------------------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000003', true);
set local role authenticated;
select throws_ok($$select api.crear_cliente('web:t20-x1', 'Z', 'mayoreo', null)$$, '42501', null, 'omar activo: crear_cliente denegado');
select throws_ok($$select api.editar_cliente('web:t20-x2', 1, 'Z', null, null, null)$$, '42501', null, 'omar: editar_cliente denegado');
select throws_ok($$select api.fijar_precio('web:t20-x3', 1, 1, 100, '2026-05-01', 'chat', null)$$, '42501', null, 'omar: fijar_precio denegado');
select throws_ok($$select api.fijar_costo('web:t20-x4', 'Isaac', 1, 100, '2026-05-01', 'x', null, false, true)$$, '42501', null, 'omar: fijar_costo denegado');
select throws_ok($$select api.costo_historial(1)$$, '42501', null, 'omar: costo_historial denegado');
reset role;
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000004', true);
set local role authenticated;
select throws_ok($$select api.crear_cliente('web:t20-x5', 'Z', 'mayoreo', null)$$, '42501', null, 'omar desactivado: denegado');
reset role;
set local role anon;
select throws_ok($$select api.crear_cliente('web:t20-x6', 'Z', 'mayoreo', null)$$, '42501', null, 'anon: crear_cliente no ejecutable');
select throws_ok($$select api.fijar_precio('web:t20-x7', 1, 1, 100, '2026-05-01', 'chat', null)$$, '42501', null, 'anon: fijar_precio no ejecutable');
select throws_ok($$select api.costo_historial(1)$$, '42501', null, 'anon: costo_historial no ejecutable');
reset role;
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000001', true);
select set_config('t20.mod', (select mod::text from _ids), true);
set local role authenticated;
select lives_ok($$select api.costo_historial(current_setting('t20.mod')::bigint)$$, 'socio autenticado: ejecuta por la API');
reset role;

select * from finish();
rollback;
