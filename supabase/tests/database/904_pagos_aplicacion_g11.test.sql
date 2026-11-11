-- pgTAP 904 (QA de punta a punta, H-04, H-07): aplicar_pago, aplicar_fifo, pago_disponible, identificar_pago, registrar_entrega_socio,
-- saldo a favor y el caso dorado G11 de la auditoria 01 (pedido de 9,000 cobrado en dos cuentas de socio, anulacion de una parte).
-- Cifras a mano en el comentario de cada prueba. ESCRITA SIN EJECUTAR (sin Docker). Datos sinteticos "N904".
begin;
select no_plan();

insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('n904.socio@example.test', 'socio', 'Angelo', true);
insert into auth.users (id, instance_id, aud, role, email) values ('96666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'n904.socio@example.test');
select set_config('request.jwt.claim.sub', '96666666-6666-6666-6666-666666666666', true);

-- Punto de partida: se neutralizan los saldos de socios dentro de la transaccion (se revierte).
select operacion.crear_evento('ajuste_prueba', negocio.hoy(), 'neutro-904', '{}'::jsonb);
insert into operacion.cuenta_socio_mov (socio_id, fecha_neg, concepto, aplica_a, monto_cent, nota, evento_id)
  select s.id, negocio.hoy(), 'entrega_a_sociedad', a.k, -operacion.saldo_socio(s.id, a.k), 'neutraliza para la prueba', (select max(id) from operacion.evento)
  from catalogo.socio s cross join (values ('fondos'), ('diferencia'), ('general')) a(k) where operacion.saldo_socio(s.id, a.k) <> 0;

create function pg_temp.pid(p_clave text) returns bigint language sql as $$ select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.pgid(p_clave text) returns bigint language sql as $$ select (resultado->>'pago_id')::bigint from seguridad.operacion where clave = $1 $$;
create function pg_temp.cid(p text) returns bigint language sql as $$ select id from catalogo.cliente where nombre_canonico = $1 $$;
create function pg_temp.sid(p text) returns bigint language sql as $$ select id from catalogo.socio where nombre = $1 $$;
create function pg_temp.fondos(p text) returns bigint language sql as $$ select operacion.saldo_socio((select id from catalogo.socio where nombre = $1), 'fondos') $$;

select catalogo.asegurar_cliente('N904 Cliente A', 'Angelo');
select catalogo.asegurar_cliente('N904 Cliente B', 'Javier');
select catalogo.asegurar_modelo('N904 Marca', 'N904 Modelo 30K', 30000, 'ambas');
select catalogo.asegurar_sku('N904 Modelo 30K', 'Sandia');
select catalogo.fijar_costo('n904c1', 'Isaac', 'N904 Modelo 30K', 10000, '2027-03-01', 'prueba');
select catalogo.fijar_precio('n904p1', 'N904 Cliente A', 'N904 Modelo 30K', 15000, '2027-03-01', 'chat');
select catalogo.fijar_precio('n904p2', 'N904 Cliente B', 'N904 Modelo 30K', 15000, '2027-03-01', 'chat');
select operacion.registrar_movimiento('n904m1', 'N904 Modelo 30K', 'Sandia', 'bodega_omar', 'entrada_compra', 400, 4000000, '2027-03-01');

-- Dos pedidos enviados de N904 Cliente A: P1 = 60 pz x 150 = 9,000.00 (1-mar) y P2 = 20 pz x 150 = 3,000.00 (2-mar) --------------------------------
select operacion.crear_pedido('n904a1', pg_temp.cid('N904 Cliente A'), '[{"modelo":"N904 Modelo 30K","sabor":"Sandia","piezas":60}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2027-03-01');
select operacion.confirmar_pedido('n904a1c', pg_temp.pid('n904a1'));
select is((operacion.enviar_pedido('n904a1s', pg_temp.pid('n904a1'), null, null, '2027-03-01')->>'total_cent')::bigint, 900000::bigint, 'P1 enviado: 9,000.00');
select operacion.crear_pedido('n904a2', pg_temp.cid('N904 Cliente A'), '[{"modelo":"N904 Modelo 30K","sabor":"Sandia","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2027-03-02');
select operacion.confirmar_pedido('n904a2c', pg_temp.pid('n904a2'));
select is((operacion.enviar_pedido('n904a2s', pg_temp.pid('n904a2'), null, null, '2027-03-02')->>'total_cent')::bigint, 300000::bigint, 'P2 enviado: 3,000.00');
select is(operacion.saldo_cliente(pg_temp.cid('N904 Cliente A')), 1200000::bigint, 'por cobrar del cliente: 12,000.00');

-- G11: pago de 5,000 a la cuenta de Angelo y 4,000 a la de Javier; FIFO aplica primero al pedido mas viejo --------------------------------------
select is((operacion.registrar_pago('n904g1', 'Angelo', 500000, pg_temp.cid('N904 Cliente A'), null, true, 'abono', '2027-03-03')->>'aplicado_cent')::bigint, 500000::bigint, 'G11: 5,000.00 aplicados');
select is((operacion.registrar_pago('n904g2', 'Javier', 400000, pg_temp.cid('N904 Cliente A'), null, true, 'abono', '2027-03-03')->>'aplicado_cent')::bigint, 400000::bigint, 'G11: 4,000.00 aplicados');
select is(operacion.pedido_saldo(pg_temp.pid('n904a1')), 0::bigint, 'FIFO: P1 (el mas viejo) queda saldado con 9,000.00');
select is(operacion.pedido_saldo(pg_temp.pid('n904a2')), 300000::bigint, 'FIFO: P2 sigue debiendo 3,000.00');
select is(pg_temp.fondos('Angelo'), 500000::bigint, 'G11: fondos de Angelo 5,000.00');
select is(pg_temp.fondos('Javier'), 400000::bigint, 'G11: fondos de Javier 4,000.00');
select is(operacion.pedido_aplicado(pg_temp.pid('n904a1')), 900000::bigint, 'pedido_aplicado de P1: 9,000.00');
-- Angelo paga 5,000 a Isaac con los fondos de la sociedad: sus fondos bajan a 0.
select is((operacion.pago_proveedor_de_socio('n904i1', 'Isaac', 500000, 'Angelo', 'fondos_sociedad', '2027-03-04')->>'deuda_socio_cent')::bigint, 0::bigint, 'G11: Angelo paga 5,000.00 a Isaac, su deuda queda en 0');
-- Se anula el pago de 4,000 (error del cliente): CxC +4,000 y fondos de Javier 0.
select lives_ok($$select operacion.anular_pago('n904an1', (select id from operacion.pago where monto_cent = 400000 order by id desc limit 1), 'el cliente se equivoco de cuenta')$$, 'G11: se anula el pago de 4,000.00');
select is(operacion.pedido_saldo(pg_temp.pid('n904a1')), 400000::bigint, 'G11: P1 vuelve a deber 4,000.00 (la anulacion libera lo aplicado al mas viejo)');
select is(operacion.saldo_cliente(pg_temp.cid('N904 Cliente A')), 700000::bigint, 'G11: por cobrar del cliente 7,000.00 (12,000 - 5,000)');
select is(pg_temp.fondos('Javier'), 0::bigint, 'G11: fondos de Javier 0.00');
select is(operacion.pago_disponible(pg_temp.pgid('n904g2')), 0::bigint, 'un pago anulado no tiene disponible');
select throws_ok($$select operacion.anular_pago('n904an2', (select id from operacion.pago where monto_cent = 400000 order by id desc limit 1), 'otra vez')$$, 'P0428', null, 'anular el mismo pago dos veces se rechaza');
select throws_ok($$select operacion.anular_pago('n904an3', 1, '')$$, '23502', null, 'anular exige motivo');
-- ESPERADO-FALLA-HASTA: H11 (anular un pago despues de que el socio lo entrego): ver 990_pendientes_de_correccion.

-- Pago por montos erroneos ---------------------------------------------------------------------------------------------------------
select throws_ok($$select operacion.registrar_pago('n904e1', 'Angelo', 0, (select id from catalogo.cliente where nombre_canonico = 'N904 Cliente A'))$$, '23514', null, 'pago de 0 se rechaza');
select throws_ok($$select operacion.registrar_pago('n904e2', 'Angelo', -100, (select id from catalogo.cliente where nombre_canonico = 'N904 Cliente A'))$$, '23514', null, 'pago negativo se rechaza');
select throws_ok($$select operacion.registrar_pago('n904e3', 'Cuenta Inexistente', 100)$$, '22023', null, 'cuenta desconocida');
select throws_ok($$select operacion.registrar_pago('n904e4', 'Angelo', 100, 999999999)$$, '22023', null, 'cliente desconocido');
select throws_ok($$select operacion.registrar_pago('n904e5', 'Angelo', null)$$, '23514', null, 'monto nulo se rechaza');

-- Exceso: pago de 10,000 contra 7,000 por cobrar deja 3,000 a favor; aplicar_pago directo no sobrepasa el saldo ------------------------------------
select is((operacion.registrar_pago('n904x1', 'Angelo', 1000000, pg_temp.cid('N904 Cliente A'), null, true, 'abono', '2027-03-05')->>'aplicado_cent')::bigint, 700000::bigint, 'se aplican 7,000.00, lo que habia por cobrar');
select is(operacion.saldo_favor_cliente(pg_temp.cid('N904 Cliente A')), 300000::bigint, 'el exceso queda como saldo a favor: 3,000.00');
select is(operacion.saldo_cliente(pg_temp.cid('N904 Cliente A')), 0::bigint, 'por cobrar 0.00');
select is(operacion.pago_disponible(pg_temp.pgid('n904x1')), 300000::bigint, 'pago_disponible: 3,000.00 sin aplicar');
select throws_ok($$select operacion.aplicar_pago('n904ap0', (select (resultado->>'pago_id')::bigint from seguridad.operacion where clave = 'n904x1'), (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n904a1'), 100000)$$, '23514', null, 'aplicar_pago: pedido saldado, nada que aplicar');

-- aplicar_pago con pago sin aplicar automatico ----------------------------------------------------------------------------------------
select operacion.crear_pedido('n904b1', pg_temp.cid('N904 Cliente B'), '[{"modelo":"N904 Modelo 30K","sabor":"Sandia","piezas":20}]'::jsonb, 'bodega_omar', null, 0, 0, 0, '2027-03-06');
select operacion.confirmar_pedido('n904b1c', pg_temp.pid('n904b1'));
select operacion.enviar_pedido('n904b1s', pg_temp.pid('n904b1'), null, null, '2027-03-06');
select is((operacion.registrar_pago('n904b2', 'Javier', 200000, pg_temp.cid('N904 Cliente B'), null, false, 'abono', '2027-03-06')->>'aplicado_cent')::bigint, 0::bigint, 'con p_aplicar = false no se aplica solo');
select is(operacion.pedido_saldo(pg_temp.pid('n904b1')), 300000::bigint, 'el pedido sigue debiendo 3,000.00');
select is((operacion.aplicar_pago('n904ap1', pg_temp.pgid('n904b2'), pg_temp.pid('n904b1'), 150000)->>'aplicado_cent')::bigint, 150000::bigint, 'aplicar_pago: 1,500.00');
select is(operacion.pago_disponible(pg_temp.pgid('n904b2')), 50000::bigint, 'pago_disponible: quedan 500.00');
select is((operacion.aplicar_pago('n904ap2', pg_temp.pgid('n904b2'), pg_temp.pid('n904b1'), 900000)->>'aplicado_cent')::bigint, 50000::bigint, 'aplicar_pago: nunca mas que el disponible del pago');
select is(operacion.pedido_saldo(pg_temp.pid('n904b1')), 100000::bigint, 'queda 1,000.00 por cobrar');
select throws_ok($$select operacion.aplicar_pago('n904ap3', (select (resultado->>'pago_id')::bigint from seguridad.operacion where clave = 'n904b2'), (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n904a1'), 100)$$, '22023', null, 'aplicar_pago: el pedido debe ser del mismo cliente');

-- Pago sin identificar e identificar_pago ---------------------------------------------------------------------------------------------
select is((operacion.registrar_pago('n904s1', 'Javier', 100000, null, null, true, 'abono', '2027-03-07')->>'aplicado_cent')::bigint, 0::bigint, 'sin cliente: nada se aplica');
select is((select identificacion from operacion.pago where id = pg_temp.pgid('n904s1')), 'sin_identificar', 'queda "sin_identificar"');
select is(operacion.pago_disponible(pg_temp.pgid('n904s1')), 0::bigint, 'sin cliente no hay disponible');
select is((select count(*)::int from operacion.aviso where codigo = 'pago_sin_identificar' and entidad_id = pg_temp.pgid('n904s1')), 1, 'NT-037: aviso de pago sin identificar');
select throws_ok($$select operacion.aplicar_pago('n904s2', (select (resultado->>'pago_id')::bigint from seguridad.operacion where clave = 'n904s1'), (select (resultado->>'pedido_id')::bigint from seguridad.operacion where clave = 'n904b1'), 100)$$, 'P0425', null, 'aplicar un pago sin identificar: P0425');
select is((operacion.identificar_pago('n904s3', pg_temp.pgid('n904s1'), pg_temp.cid('N904 Cliente B'))->>'aplicado_cent')::bigint, 100000::bigint, 'identificar: se asigna y se aplica FIFO (1,000.00)');
select is(operacion.pedido_saldo(pg_temp.pid('n904b1')), 0::bigint, 'el pedido de B queda saldado');
select throws_ok($$select operacion.identificar_pago('n904s4', (select (resultado->>'pago_id')::bigint from seguridad.operacion where clave = 'n904s1'), (select id from catalogo.cliente where nombre_canonico = 'N904 Cliente B'))$$, 'P0428', null, 'identificar dos veces se rechaza');

-- Comprobante repetido ----------------------------------------------------------------------------------------------------------------
select operacion.registrar_pago('n904h1', 'Javier', 10000, pg_temp.cid('N904 Cliente B'), null, false, 'abono', '2027-03-07', 'abc123');
select is((operacion.registrar_pago('n904h2', 'Javier', 10000, pg_temp.cid('N904 Cliente B'), null, false, 'abono', '2027-03-07', 'abc123')->>'duplicado')::boolean, true, 'el mismo comprobante no entra dos veces');
select is((select count(*)::int from operacion.pago where comprobante_sha256 = 'abc123'), 1, 'una sola fila');

-- Entregas de un socio ------------------------------------------------------------------------------------------------------------------
select is(pg_temp.fondos('Javier') > 0, true, 'Javier tiene fondos de los pagos a su cuenta');
create temp table _fj as select pg_temp.fondos('Javier') as f;
select throws_ok($$select operacion.registrar_entrega_socio('n904r0', 'Javier', 999999999)$$, '23514', null, 'la entrega no excede lo que tiene');
select throws_ok($$select operacion.registrar_entrega_socio('n904r1', 'Javier', 0)$$, '23514', null, 'entrega de 0 se rechaza');
select throws_ok($$select operacion.registrar_entrega_socio('n904r2', 'Javier', 100, 'otro_socio', 'Javier')$$, '22023', null, 'no se entrega a si mismo');
select lives_ok($$select operacion.registrar_entrega_socio('n904r3', 'Javier', 10000, 'otro_socio', 'Angelo')$$, 'entrega de Javier a Angelo');
select is(pg_temp.fondos('Javier'), (select f from _fj) - 10000, 'fondos de Javier bajan 100.00');
select is(pg_temp.fondos('Angelo') >= 10000, true, 'y quedan en poder de Angelo');

select * from finish();
rollback;
