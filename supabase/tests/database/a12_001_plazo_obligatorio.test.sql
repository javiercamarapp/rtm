-- pgTAP: plazo obligatorio en pedidos a credito (migracion 20261114700000). Datos sinteticos "A12".
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a12.jav@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('a1200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a12.jav@example.test');
select set_config('request.jwt.claim.sub', 'a1200000-0000-0000-0000-000000000001', true);
select catalogo.asegurar_cliente('A12 Cliente', 'Angelo');
select catalogo.asegurar_modelo('A12 Marca', 'A12 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('A12 Modelo 30K', 'Mango');
select catalogo.fijar_costo('a12c1', 'Isaac', 'A12 Modelo 30K', 10000, '2026-07-01', 'prueba');
select catalogo.fijar_costo('a12c2', 'Karen', 'A12 Modelo 30K', 9000, '2026-07-01', 'prueba');
select catalogo.fijar_precio('a12p1', 'A12 Cliente', 'A12 Modelo 30K', 15000, '2026-07-01', 'chat');
create function pg_temp.cli() returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = 'A12 Cliente' $$;
create function pg_temp.lin() returns jsonb language sql as $$ select '[{"modelo":"A12 Modelo 30K","sabor":"Mango","piezas":20}]'::jsonb $$;

-- Web
select throws_ok($$select api.crear_pedido('a12-w1', pg_temp.cli(), pg_temp.lin())$$, 'P0436', null, 'web: sin plazo se rechaza');
select throws_ok($$select api.crear_pedido('a12-w2', pg_temp.cli(), pg_temp.lin(), p_plazo_dias => -1)$$, 'P0436', null, 'web: plazo negativo se rechaza');
select throws_ok($$select api.crear_pedido('a12-w3', pg_temp.cli(), pg_temp.lin(), p_plazo_dias => 366)$$, 'P0436', null, 'web: plazo de mas de 365 dias se rechaza');
select is((select count(*) from seguridad.operacion where clave like 'a12-w%')::int, 0, 'web: lo rechazado no deja pedido ni operacion');
select lives_ok($$select api.crear_pedido('a12-w4', pg_temp.cli(), pg_temp.lin(), p_plazo_dias => 15)$$, 'web: con plazo de 15 dias se crea');
select is((select plazo_dias from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a12-w4')), 15, 'web: el pedido guarda el plazo');
select lives_ok($$select api.crear_pedido('a12-w5', pg_temp.cli(), pg_temp.lin(), p_plazo_dias => 0)$$, 'web: contado = plazo 0 se crea');
select is((select plazo_dias from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a12-w5')), 0, 'web: contado guarda plazo 0');
select is(api.crear_pedido('a12-w4', pg_temp.cli(), pg_temp.lin(), p_plazo_dias => 15) = (select resultado from seguridad.operacion where clave = 'a12-w4'), true, 'web: repetir la misma clave devuelve lo guardado');

-- Dropshipping
select throws_ok($$select operacion.ds_crear_pedido('a12-d1', pg_temp.cli(), pg_temp.lin(), 'karen_directo', null, '{"tasa_semanal_bp":1000}'::jsonb)$$, 'P0436', null, 'ds: credito sin fecha ni semanas se rechaza');
select lives_ok($$select operacion.ds_crear_pedido('a12-d2', pg_temp.cli(), pg_temp.lin(), 'karen_directo', null, '{"fecha_pago":"2026-11-20"}'::jsonb, p_fecha => '2026-11-14')$$, 'ds: credito con fecha de pago explicita se crea');
select is((select plazo_dias from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a12-d2:ped')), 6, 'ds: el plazo es la distancia a la fecha de pago');
select lives_ok($$select operacion.ds_crear_pedido('a12-d3', pg_temp.cli(), pg_temp.lin(), 'karen_directo', null, '{"semanas":2}'::jsonb)$$, 'ds: credito con semanas explicitas se crea');
select lives_ok($$select operacion.ds_crear_pedido('a12-d4', pg_temp.cli(), pg_temp.lin(), 'karen_directo')$$, 'ds: contado (sin credito) no cambia');

select is((select plazo_dias from operacion.pedido where id = (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a12-d4:ped')), 0, 'ds: el contado queda con plazo 0 (nunca NULL)');
select throws_ok($$select operacion.ds_crear_pedido('a12-d5', pg_temp.cli(), pg_temp.lin(), 'karen_directo', null, '{"semanas":0}'::jsonb)$$, 'P0436', null, 'ds: credito de 0 semanas se rechaza (el contado se declara como contado)');
select throws_ok($$select operacion.ds_crear_pedido('a12-d6', pg_temp.cli(), pg_temp.lin(), 'karen_directo', null, null, 'socio_a_costo', 'Angelo')$$, 'P0436', null, 'ds: pedido a costo del socio sin fecha de pago se rechaza');

-- Bot
select throws_ok($$select agente._ejecutar_ext_base('a12-b1', 'pedido_crear', jsonb_build_object('autor', 'javier', 'cliente_id', pg_temp.cli(), 'lineas', '[]'::jsonb))$$, 'P0436', null, 'bot: pedido sin plazo se rechaza antes de escribir');
select throws_ok($$select agente._ejecutar_ext_base('a12-b2', 'pedido_crear', jsonb_build_object('autor', 'javier', 'cliente_id', pg_temp.cli(), 'lineas', '[]'::jsonb, 'plazo_dias', 400))$$, 'P0436', null, 'bot: plazo fuera de rango se rechaza');

select * from finish();
rollback;
