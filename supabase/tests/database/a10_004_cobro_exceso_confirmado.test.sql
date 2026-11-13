-- pgTAP a10_004 (campana E2E maestra, MEDIO-3): api.registrar_pago rechaza un cobro mayor que lo que debe el cliente salvo confirmacion explicita (p_confirmo_exceso), igual que Pago renta.
-- Cifras a mano (centavos): pedido de 100 pzas a 200.00 = 2,000,000 (20,000.00). Un cobro de 9,999,999.00 (999,999,900) es 50 veces el saldo.
begin;
select no_plan();
insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('a104.javier@example.test', 'socio', 'Javier', true);
insert into auth.users (id, instance_id, aud, role, email) values ('a1046666-6666-6666-6666-666666666662', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a104.javier@example.test');
select set_config('request.jwt.claim.sub', 'a1046666-6666-6666-6666-666666666662', true);
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.ped(p text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;

select catalogo.asegurar_cliente('A104 Cliente', 'Javier');
select catalogo.asegurar_modelo('A104 Marca', 'A104 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('A104 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('a104cc', 'Isaac', 'A104 Modelo 30K', 10000, '2020-01-01', 'prueba');
select catalogo.fijar_precio('a104cp', 'A104 Cliente', 'A104 Modelo 30K', 20000, '2020-01-01', 'chat');
select operacion.crear_pedido('a104pe', pg_temp.cid('A104 Cliente'), '[{"modelo":"A104 Modelo 30K","sabor":"Sandia","piezas":100}]'::jsonb, 'isaac_directo', null, 0, 0, 0, '2021-03-03');
select operacion.confirmar_pedido('a104pec', pg_temp.ped('a104pe'));
select operacion.enviar_pedido('a104pes', pg_temp.ped('a104pe'), null, '{"paqueteria":"Castores","numero":"A104-G1","costo_cent":0}'::jsonb, '2021-03-03', true);
set constraints all immediate;
select is(operacion.pedido_saldo(pg_temp.ped('a104pe')), 2000000::bigint, 'el pedido debe 20,000.00');

-- El cobro 50 veces el saldo se rechaza con su codigo propio y NO registra nada.
select throws_ok($$select api.registrar_pago('a104x1', 'Efectivo', 999999900, (select id from catalogo.cliente where nombre_canonico = 'A104 Cliente'), jsonb_build_array(jsonb_build_object('pedido_id', (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'a104pe'), 'monto_cent', 999999900)), true, 'abono', '2021-03-04')$$,
  'P0429', null, 'un cobro de 9,999,999.00 contra un saldo de 20,000.00 se rechaza sin confirmacion');
select is((select count(*)::int from operacion.pago), 0, 'el rechazo no dejo ningun pago');
select is((select count(*)::int from seguridad.operacion where clave = 'a104x1'), 0, 'ni dejo la clave de idempotencia a medias');
select throws_ok($$select api.registrar_pago('a104x2', 'Efectivo', 2000001, (select id from catalogo.cliente where nombre_canonico = 'A104 Cliente'), null, true, 'abono', '2021-03-04')$$, 'P0429', null, 'sin lista de pedidos: un centavo de mas sobre el saldo total tambien pide confirmacion');
select throws_ok($$select api.registrar_pago('a104x3', 'Efectivo', 999999900, (select id from catalogo.cliente where nombre_canonico = 'A104 Cliente'))$$, 'P0429', null, 'con los valores por omision (aplicar a pedidos) tambien');

-- Dentro del saldo: sin confirmacion y sin cambio de comportamiento.
select is((api.registrar_pago('a104p1', 'Efectivo', 500000, pg_temp.cid('A104 Cliente'), jsonb_build_array(jsonb_build_object('pedido_id', pg_temp.ped('a104pe'), 'monto_cent', 500000)), true, 'abono', '2021-03-04')->>'aplicado_cent')::bigint, 500000::bigint, 'un abono parcial de 5,000.00 se aplica entero');
select is(operacion.pedido_saldo(pg_temp.ped('a104pe')), 1500000::bigint, 'quedan 15,000.00');
select is((api.registrar_pago('a104p2', 'Efectivo', 1500000, pg_temp.cid('A104 Cliente'), jsonb_build_array(jsonb_build_object('pedido_id', pg_temp.ped('a104pe'), 'monto_cent', 1500000)), true, 'abono', '2021-03-05')->>'aplicado_cent')::bigint, 1500000::bigint, 'el cobro exacto del saldo pasa sin confirmacion');
select is(operacion.pedido_saldo(pg_temp.ped('a104pe')), 0::bigint, 'el pedido queda saldado');
-- Repetir la misma clave devuelve el mismo resultado aunque el saldo ya sea cero (no vuelve a medir).
select is((api.registrar_pago('a104p2', 'Efectivo', 1500000, pg_temp.cid('A104 Cliente'), jsonb_build_array(jsonb_build_object('pedido_id', pg_temp.ped('a104pe'), 'monto_cent', 1500000)), true, 'abono', '2021-03-05')->>'aplicado_cent')::bigint, 1500000::bigint, 'la repeticion idempotente no se rechaza por exceso');
select is((select count(*)::int from operacion.pago), 2, 'y no duplica el pago');

-- Con confirmacion explicita el exceso queda como saldo a favor del cliente.
select is((api.registrar_pago('a104c1', 'Efectivo', 300000, pg_temp.cid('A104 Cliente'), null, true, 'abono', '2021-03-06', null, null, null, null, true)->>'saldo_favor_cliente_cent')::bigint, 300000::bigint, 'confirmado: el cobro de 3,000.00 sin nada que deber queda a favor del cliente');
-- Un anticipo explicito (tipo anticipo, o sin aplicar) no pide confirmacion.
select is((api.registrar_pago('a104a1', 'Efectivo', 100000, pg_temp.cid('A104 Cliente'), null, false, 'anticipo', '2021-03-06')->>'monto_cent')::bigint, 100000::bigint, 'un anticipo explicito se registra sin confirmar');
-- Un cobro sin cliente (sin identificar) no se mide contra ningun saldo.
select is((api.registrar_pago('a104s1', 'Efectivo', 100000, null, null, true, 'abono', '2021-03-06')->>'monto_cent')::bigint, 100000::bigint, 'sin identificar: no hay saldo contra el cual medirlo');
-- Tope absoluto de 10,000,000.00 por cobro, ni con confirmacion.
select throws_ok($$select api.registrar_pago('a104t1', 'Efectivo', 1000000001, (select id from catalogo.cliente where nombre_canonico = 'A104 Cliente'), null, true, 'abono', '2021-03-06', null, null, null, null, true)$$, '23514', null, 'el tope de 10,000,000.00 por cobro no se salta ni confirmando');
-- La funcion interna (cargador, agente y pruebas previas) no cambia.
select lives_ok($$select operacion.registrar_pago('a104i1', 'Efectivo', 999999900, (select id from catalogo.cliente where nombre_canonico = 'A104 Cliente'), null, true, 'abono', '2021-03-07')$$, 'operacion.registrar_pago conserva su comportamiento');
-- Permisos.
select is(has_function_privilege('authenticated', 'api.registrar_pago(text,text,bigint,bigint,jsonb,boolean,text,date,text,text,text,bigint,boolean)', 'execute'), true, 'GRANT: authenticated ejecuta la firma nueva (valida el rol socio dentro)');
select is(has_function_privilege('anon', 'api.registrar_pago(text,text,bigint,bigint,jsonb,boolean,text,date,text,text,text,bigint,boolean)', 'execute'), false, 'GRANT: anon no');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' and p.proname = 'registrar_pago'), 1, 'una sola firma de api.registrar_pago (la anterior se retiro)');
select * from finish();
rollback;
